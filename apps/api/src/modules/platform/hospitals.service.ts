import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as bcrypt from 'bcryptjs';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { TenantMigrationService } from '../../common/tenant/tenant-migration.service';
import { TenantUserProvisioningService } from '../../common/tenant/tenant-user-provisioning.service';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { recordPlatformAuditLog } from '../../common/tenant/platform-audit.util';
import { StaffService } from '../user/staff.service';
import { TEMP_PASSWORD_TTL_MS } from '../user/account-lifecycle.service';
import { DEFAULT_BULK_ROLES } from '../user/dto/create-default-roles.dto';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { UpdateHospitalStatusDto } from './dto/update-hospital-status.dto';
import { ResetHospitalUserPasswordDto } from './dto/reset-hospital-user-password.dto';
import { ResetAllHospitalUserPasswordsDto } from './dto/reset-all-hospital-user-passwords.dto';

/**
 * Every auto-created role account for a newly onboarded hospital, EXCEPT
 * Doctor and Administrator: Administrator is provisioned separately (its own
 * identifier, via provisionAdministrator), and Doctor accounts are
 * deliberately never auto-created -- a hospital's real doctors are added by
 * its own Administrator afterward, not seeded as placeholders.
 */
const HOSPITAL_ONBOARDING_ROLES = DEFAULT_BULK_ROLES.filter((r) => r !== 'Doctor');

const execFileAsync = promisify(execFile);

// apps/api/ -- same relative depth from __dirname in both ts-node (src/modules/platform)
// and compiled (dist/modules/platform) execution.
const API_ROOT = path.resolve(__dirname, '..', '..', '..');

// Prisma's CLI entrypoint is a plain JS file (`prisma`'s package.json
// `bin.prisma` -> "build/index.js") -- resolving and running it directly via
// `node <script> ...` avoids shelling out to the `prisma`/`npx` *shim*
// (a .cmd/.ps1 file on Windows), which either fails outright
// (execFile can't spawn a .cmd without a shell -> ENOENT/EINVAL) or requires
// `shell: true`, which Node flags as a real footgun (DEP0190: shell-mode
// args aren't escaped). Invoking the JS entrypoint with `node` needs no
// shell at all, on any platform.
const PRISMA_CLI_ENTRYPOINT = require.resolve('prisma/build/index.js');

// Defense in depth on top of CreateHospitalDto's own slug regex: this is the
// exact shape createHospital()/remove() build before running raw DDL, so
// re-checking it here means a bug anywhere upstream of this service (a
// changed DTO, a different call site) still can't turn `schemaName` into
// something other than a safe, generated identifier.
const SCHEMA_NAME_RE = /^hospital_[a-z0-9_]+$/;

@Injectable()
export class HospitalsService {
  private readonly logger = new Logger(HospitalsService.name);

  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly tenantClients: TenantClientFactory,
    private readonly userProvisioning: TenantUserProvisioningService,
    private readonly staffService: StaffService,
    private readonly tenantMigration: TenantMigrationService,
  ) {}

  /**
   * Auto-creates the standard non-Doctor, non-Administrator role roster for a
   * freshly onboarded hospital, all sharing `initialPassword` -- hashed
   * independently per account by StaffService.createStaff/createDoctor, each
   * forced to change it on first login. Runs inside runWithTenant() because
   * StaffService (like every AccountLifecycleService subclass) reads/writes
   * through PrismaService, which resolves the active tenant from
   * AsyncLocalStorage rather than a hospitalId parameter -- there is no
   * HTTP request/TenantResolutionMiddleware here to have set that up already.
   */
  private async provisionDefaultRoleAccounts(
    schemaName: string,
    hospitalId: string,
    initialPassword: string,
    confirmPassword: string,
    platformUserId: string,
  ) {
    const client = await this.tenantClients.getClient(schemaName);
    return runWithTenant({ hospitalId, schemaName, prismaClient: client }, () =>
      this.staffService.createDefaultRoleAccounts(
        {
          initialPassword,
          confirmPassword,
          roles: [...HOSPITAL_ONBOARDING_ROLES],
          requirePasswordChange: true,
        },
        { id: platformUserId, roleName: 'SuperAdmin', type: 'platform' },
      ),
    );
  }

  async list() {
    return this.platformPrisma.hospital.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getById(id: string) {
    return this.platformPrisma.hospital.findUnique({ where: { id } });
  }

  /**
   * Onboards a new hospital: creates its Postgres schema, runs the tenant
   * migrations and seed against it, creates its first Administrator user,
   * and registers it in the platform DB. Runs synchronously within this
   * request (shelling out to the Prisma CLI, which requires the long-lived
   * server this app is deployed on -- not a serverless function) -- for a
   * large tenant-migration history this could take a while, which is an
   * accepted tradeoff for now rather than building async job-status polling.
   */
  async createHospital(dto: CreateHospitalDto, platformUserId: string) {
    const existing = await this.platformPrisma.hospital.findUnique({ where: { slug: dto.slug } });
    if (existing) {
      if (existing.status === 'PROVISIONING') {
        return this.resumeProvisioning(existing, dto, platformUserId);
      }
      throw new ConflictException(`A hospital with slug "${dto.slug}" already exists.`);
    }

    const schemaName = `hospital_${dto.slug.replace(/-/g, '_')}`;
    if (!SCHEMA_NAME_RE.test(schemaName)) {
      throw new InternalServerErrorException(
        'Invalid schema name generated -- refusing to run DDL.',
      );
    }

    const hospital = await this.platformPrisma.hospital.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        schemaName,
        status: 'PROVISIONING',
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        address: dto.address,
      },
    });

    try {
      await this.platformPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
      await this.runMigrateDeploy(schemaName);
      await this.runSeed(schemaName);
      await this.userProvisioning.registerSeededIdentifiers(schemaName, hospital.id);
      await this.userProvisioning.provisionAdministrator(
        schemaName,
        hospital.id,
        dto.adminIdentifier,
        dto.initialPassword,
        { idempotentResume: true },
      );
      const roleAccounts = await this.provisionDefaultRoleAccounts(
        schemaName,
        hospital.id,
        dto.initialPassword,
        dto.confirmPassword,
        platformUserId,
      );

      const activated = await this.platformPrisma.hospital.update({
        where: { id: hospital.id },
        data: { status: 'ACTIVE' },
      });
      await recordPlatformAuditLog(this.platformPrisma, {
        platformUserId,
        action: 'hospital.create',
        hospitalId: hospital.id,
        resource: 'Hospital',
        // Roles/identifiers only -- never the password, same as the summary
        // audit createDefaultRoleAccounts already writes on the tenant side.
        metadata: {
          name: dto.name,
          slug: dto.slug,
          rolesCreated: roleAccounts.created.map((c) => c.role),
        },
      });
      return { ...activated, adminIdentifier: dto.adminIdentifier, roleAccounts };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Onboarding failed for hospital "${dto.slug}": ${message}`);

      // Best-effort cleanup so a failed attempt doesn't leave a half-built
      // schema, a dangling platform-DB row, or orphaned login-directory rows
      // behind. The directory rows MUST go before the hospital row: the
      // hospital FK SET NULLs on delete, which would otherwise strand them as
      // ownerless rows that permanently block reusing the same identifiers
      // ("already registered to a platform account") on every retry.
      await this.platformPrisma
        .$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .catch(() => undefined);
      await this.platformPrisma.loginIdentifier
        .deleteMany({ where: { hospitalId: hospital.id } })
        .catch(() => undefined);
      await this.platformPrisma.hospital
        .delete({ where: { id: hospital.id } })
        .catch(() => undefined);

      throw new InternalServerErrorException('Failed to onboard hospital. Please try again or contact support.');
    }
  }

  private async resumeProvisioning(
    hospital: {
      id: string;
      slug: string;
      schemaName: string;
    },
    dto: CreateHospitalDto,
    platformUserId: string,
  ) {
    if (!SCHEMA_NAME_RE.test(hospital.schemaName)) {
      throw new InternalServerErrorException(
        'Invalid schema name on provisioning record -- refusing to run DDL.',
      );
    }

    try {
      await this.platformPrisma.$executeRawUnsafe(
        `CREATE SCHEMA IF NOT EXISTS "${hospital.schemaName}"`,
      );
      await this.runMigrateDeploy(hospital.schemaName);
      await this.runSeed(hospital.schemaName);
      await this.userProvisioning.registerSeededIdentifiers(hospital.schemaName, hospital.id);
      await this.userProvisioning.provisionAdministrator(
        hospital.schemaName,
        hospital.id,
        dto.adminIdentifier,
        dto.initialPassword,
        { idempotentResume: true },
      );
      const roleAccounts = await this.provisionDefaultRoleAccounts(
        hospital.schemaName,
        hospital.id,
        dto.initialPassword,
        dto.confirmPassword,
        platformUserId,
      );

      const activated = await this.platformPrisma.hospital.update({
        where: { id: hospital.id },
        data: { status: 'ACTIVE' },
      });
      await recordPlatformAuditLog(this.platformPrisma, {
        platformUserId,
        action: 'hospital.resume_provisioning',
        hospitalId: hospital.id,
        resource: 'Hospital',
        metadata: { rolesCreated: roleAccounts.created.map((c) => c.role) },
      });
      return { ...activated, adminIdentifier: dto.adminIdentifier, roleAccounts };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to resume hospital onboarding for "${hospital.slug}": ${message}`);
      throw new InternalServerErrorException(
        'Failed to resume hospital onboarding. Please try again or contact support.',
      );
    }
  }

  private schemaQualifiedDatabaseUrl(schemaName: string): string {
    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) throw new BadRequestException('DATABASE_URL is not set');
    const url = new URL(baseUrl);
    url.searchParams.set('schema', schemaName);
    return url.toString();
  }

  private async runMigrateDeploy(schemaName: string): Promise<void> {
    // Single implementation lives on TenantMigrationService (also used by
    // the startup reconciliation) so creation-time and boot-time migration
    // can never drift apart.
    await this.tenantMigration.migrateTenantSchema(schemaName);
  }

  private async runSeed(schemaName: string): Promise<void> {
    await execFileAsync(process.execPath, [PRISMA_CLI_ENTRYPOINT, 'db', 'seed'], {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: this.schemaQualifiedDatabaseUrl(schemaName) },
    });
  }

  private async requireHospital(id: string) {
    const hospital = await this.platformPrisma.hospital.findUnique({ where: { id } });
    if (!hospital) throw new NotFoundException(`Hospital not found: ${id}`);
    return hospital;
  }

  /** Edits a hospital's own details -- never its slug/schemaName, both fixed at onboarding. */
  async update(id: string, dto: UpdateHospitalDto, platformUserId: string) {
    await this.requireHospital(id);
    const updated = await this.platformPrisma.hospital.update({
      where: { id },
      data: {
        name: dto.name,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        address: dto.address,
      },
    });
    await recordPlatformAuditLog(this.platformPrisma, {
      platformUserId,
      action: 'hospital.update',
      hospitalId: id,
      resource: 'Hospital',
    });
    return updated;
  }

  /**
   * Suspends or reactivates a hospital. A SUSPENDED hospital's staff can no
   * longer log in (AuthService.resolveHospital checks status) and the
   * platform Super Admin's X-Hospital-Id impersonation is also rejected
   * (TenantResolutionMiddleware) -- suspension blocks every path into the
   * tenant's data, not just one of them.
   */
  async setStatus(id: string, dto: UpdateHospitalStatusDto, platformUserId: string) {
    const hospital = await this.requireHospital(id);
    if (hospital.status === 'PROVISIONING') {
      throw new BadRequestException(
        'Cannot change status of a hospital that is still provisioning.',
      );
    }
    const updated = await this.platformPrisma.hospital.update({
      where: { id },
      data: { status: dto.status },
    });
    await recordPlatformAuditLog(this.platformPrisma, {
      platformUserId,
      action: 'hospital.set_status',
      hospitalId: id,
      resource: 'Hospital',
      metadata: { from: hospital.status, to: dto.status },
    });
    return updated;
  }

  /**
   * Resets any user's password within a specific hospital's schema -- not
   * just its Administrator -- since a Super Admin recovering a locked-out
   * account has no other way to identify which user without first looking,
   * and restricting this to "the first admin" specifically would be an
   * arbitrary and less useful restriction.
   */
  async resetHospitalUserPassword(
    id: string,
    dto: ResetHospitalUserPasswordDto,
    platformUserId: string,
  ) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('New password and confirmation do not match.');
    }
    const hospital = await this.requireHospital(id);
    const client = await this.tenantClients.getClient(hospital.schemaName);
    // Tenant User.identifier is always stored lowercased (see
    // TenantUserProvisioningService) -- normalize the lookup the same way,
    // or a case-mismatched identifier here would always 404 even for a real,
    // existing user.
    const normalizedIdentifier = dto.identifier.trim().toLowerCase();
    const user = await client.user.findUnique({ where: { identifier: normalizedIdentifier } });
    if (!user) {
      throw new NotFoundException(`No user "${dto.identifier}" found in ${hospital.name}.`);
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await client.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // A Platform-Admin-issued reset is a temporary credential exactly
        // like every other reset path in this app -- must be changed on
        // next login, and every outstanding token for this user is
        // invalidated immediately, not left valid until it naturally expires.
        mustChangePassword: true,
        passwordChangedAt: null,
        tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS),
        tokenVersion: { increment: 1 },
      },
    });
    // Never record the new password itself -- only that a reset happened and
    // for whom, matching the lesson from the plaintext-temp-password-in-audit-log
    // issue found elsewhere in this codebase.
    await recordPlatformAuditLog(this.platformPrisma, {
      platformUserId,
      action: 'hospital.reset_user_password',
      hospitalId: id,
      resource: 'User',
      metadata: { identifier: normalizedIdentifier },
    });
    return { reset: true, identifier: dto.identifier };
  }

  /**
   * Bulk equivalent of resetHospitalUserPassword(): resets every ACTIVE
   * user's password in one hospital to the same new temporary password,
   * each hashed independently, each forced to change it on next login. Never
   * touches a deactivated account (an admin who wants a specific deactivated
   * user reset must reactivate it first, a deliberate extra step so this
   * can't be used to silently bring back an intentionally disabled account)
   * or any other hospital's schema -- the tenant client is resolved from
   * `id` alone, never anything the caller sends about which rows to affect.
   */
  async resetAllHospitalUserPasswords(
    id: string,
    dto: ResetAllHospitalUserPasswordsDto,
    platformUserId: string,
  ) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('New password and confirmation do not match.');
    }
    const hospital = await this.requireHospital(id);
    const client = await this.tenantClients.getClient(hospital.schemaName);

    const users = await client.user.findMany({
      where: { active: true },
      select: { id: true, identifier: true },
    });
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    for (const user of users) {
      await client.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: null,
          tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS),
          tokenVersion: { increment: 1 },
        },
      });
    }

    // One summary entry, not one per user -- matches the pattern
    // StaffService.createDefaultRoleAccounts already uses for the same
    // "many accounts, one administrative action" shape. Never the password.
    await recordPlatformAuditLog(this.platformPrisma, {
      platformUserId,
      action: 'hospital.reset_all_user_passwords',
      hospitalId: id,
      resource: 'User',
      metadata: { affectedCount: users.length, identifiers: users.map((u) => u.identifier) },
    });

    return {
      reset: true,
      affectedCount: users.length,
      identifiers: users.map((u) => u.identifier),
    };
  }

  /**
   * Permanently deprovisions a hospital: drops its Postgres schema (all data
   * gone, irreversibly) and removes its platform-DB row. Allowed on an
   * already-SUSPENDED hospital (a deliberate two-step "suspend, confirm it's
   * really the one you meant, then delete" flow for a hospital that may hold
   * real data) or on one still stuck in PROVISIONING (no confirmation step
   * needed there -- a failed/incomplete onboarding attempt never has live
   * tenant data to protect, and prior to this it had no recovery path at all:
   * resumeProvisioning() can keep failing indefinitely with nothing able to
   * clear the record so the operator can retry, e.g. under a fresh slug).
   */
  async remove(id: string, platformUserId: string) {
    const hospital = await this.requireHospital(id);
    if (hospital.status !== 'SUSPENDED' && hospital.status !== 'PROVISIONING') {
      throw new BadRequestException(
        'Suspend a hospital before deleting it, to confirm this is intentional.',
      );
    }
    if (!SCHEMA_NAME_RE.test(hospital.schemaName)) {
      throw new InternalServerErrorException(
        'Invalid schema name on record -- refusing to run DDL.',
      );
    }
    await this.platformPrisma.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${hospital.schemaName}" CASCADE`,
    );
    // Free up its staff's identifiers for reuse -- otherwise a deleted
    // hospital's emails stay permanently unusable on the whole platform.
    await this.platformPrisma.loginIdentifier.deleteMany({ where: { hospitalId: id } });
    await this.platformPrisma.hospital.delete({ where: { id } });
    // The hospital row is gone (its FK is ON DELETE SET NULL, so this entry
    // will show no hospital once queried) -- capture identifying details in
    // metadata since there's no longer a row to join against for them.
    await recordPlatformAuditLog(this.platformPrisma, {
      platformUserId,
      action: 'hospital.delete',
      resource: 'Hospital',
      metadata: { name: hospital.name, slug: hospital.slug, hospitalId: id },
    });
    return { deleted: true };
  }
}
