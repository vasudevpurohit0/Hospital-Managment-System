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
import { TenantUserProvisioningService } from '../../common/tenant/tenant-user-provisioning.service';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { UpdateHospitalStatusDto } from './dto/update-hospital-status.dto';
import { ResetHospitalUserPasswordDto } from './dto/reset-hospital-user-password.dto';

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
  ) { }

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
  async createHospital(dto: CreateHospitalDto) {
    const existing = await this.platformPrisma.hospital.findUnique({ where: { slug: dto.slug } });
    if (existing) {
      if (existing.status === 'PROVISIONING') {
        return this.resumeProvisioning(existing, dto);
      }
      throw new ConflictException(`A hospital with slug "${dto.slug}" already exists.`);
    }

    const schemaName = `hospital_${dto.slug.replace(/-/g, '_')}`;
    if (!SCHEMA_NAME_RE.test(schemaName)) {
      throw new InternalServerErrorException('Invalid schema name generated -- refusing to run DDL.');
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
      await this.userProvisioning.provisionAdministrator(schemaName, hospital.id, dto.adminIdentifier, dto.adminPassword);

      return await this.platformPrisma.hospital.update({
        where: { id: hospital.id },
        data: { status: 'ACTIVE' },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Onboarding failed for hospital "${dto.slug}": ${message}`);

      // Best-effort cleanup so a failed attempt doesn't leave a half-built
      // schema or a dangling platform-DB row behind.
      await this.platformPrisma
        .$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .catch(() => undefined);
      await this.platformPrisma.hospital.delete({ where: { id: hospital.id } }).catch(() => undefined);

      throw new InternalServerErrorException(`Failed to onboard hospital: ${message}`);
    }
  }

  private async resumeProvisioning(hospital: {
    id: string;
    slug: string;
    schemaName: string;
  }, dto: CreateHospitalDto) {
    if (!SCHEMA_NAME_RE.test(hospital.schemaName)) {
      throw new InternalServerErrorException('Invalid schema name on provisioning record -- refusing to run DDL.');
    }

    try {
      await this.platformPrisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${hospital.schemaName}"`);
      await this.runMigrateDeploy(hospital.schemaName);
      await this.runSeed(hospital.schemaName);
      await this.userProvisioning.provisionAdministrator(hospital.schemaName, hospital.id, dto.adminIdentifier, dto.adminPassword);

      return await this.platformPrisma.hospital.update({
        where: { id: hospital.id },
        data: { status: 'ACTIVE' },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to resume hospital onboarding for "${hospital.slug}": ${message}`);
      throw new InternalServerErrorException(`Failed to resume hospital onboarding: ${message}`);
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
    await execFileAsync(process.execPath, [PRISMA_CLI_ENTRYPOINT, 'migrate', 'deploy', '--schema=prisma/schema.prisma'], {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: this.schemaQualifiedDatabaseUrl(schemaName) },
    });
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
  async update(id: string, dto: UpdateHospitalDto) {
    await this.requireHospital(id);
    return this.platformPrisma.hospital.update({
      where: { id },
      data: {
        name: dto.name,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        address: dto.address,
      },
    });
  }

  /**
   * Suspends or reactivates a hospital. A SUSPENDED hospital's staff can no
   * longer log in (AuthService.resolveHospital checks status) and the
   * platform Super Admin's X-Hospital-Id impersonation is also rejected
   * (TenantResolutionMiddleware) -- suspension blocks every path into the
   * tenant's data, not just one of them.
   */
  async setStatus(id: string, dto: UpdateHospitalStatusDto) {
    const hospital = await this.requireHospital(id);
    if (hospital.status === 'PROVISIONING') {
      throw new BadRequestException('Cannot change status of a hospital that is still provisioning.');
    }
    return this.platformPrisma.hospital.update({ where: { id }, data: { status: dto.status } });
  }

  /**
   * Resets any user's password within a specific hospital's schema -- not
   * just its Administrator -- since a Super Admin recovering a locked-out
   * account has no other way to identify which user without first looking,
   * and restricting this to "the first admin" specifically would be an
   * arbitrary and less useful restriction.
   */
  async resetHospitalUserPassword(id: string, dto: ResetHospitalUserPasswordDto) {
    const hospital = await this.requireHospital(id);
    const client = await this.tenantClients.getClient(hospital.schemaName);
    const user = await client.user.findUnique({ where: { identifier: dto.identifier } });
    if (!user) {
      throw new NotFoundException(`No user "${dto.identifier}" found in ${hospital.name}.`);
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await client.user.update({ where: { id: user.id }, data: { passwordHash } });
    return { reset: true, identifier: dto.identifier };
  }

  /**
   * Permanently deprovisions a hospital: drops its Postgres schema (all data
   * gone, irreversibly) and removes its platform-DB row. Only allowed on an
   * already-SUSPENDED hospital -- a deliberate two-step "suspend, confirm
   * it's really the one you meant, then delete" flow, since this cannot be
   * undone.
   */
  async remove(id: string) {
    const hospital = await this.requireHospital(id);
    if (hospital.status !== 'SUSPENDED') {
      throw new BadRequestException('Suspend a hospital before deleting it, to confirm this is intentional.');
    }
    if (!SCHEMA_NAME_RE.test(hospital.schemaName)) {
      throw new InternalServerErrorException('Invalid schema name on record -- refusing to run DDL.');
    }
    await this.platformPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${hospital.schemaName}" CASCADE`);
    // Free up its staff's identifiers for reuse -- otherwise a deleted
    // hospital's emails stay permanently unusable on the whole platform.
    await this.platformPrisma.loginIdentifier.deleteMany({ where: { hospitalId: id } });
    await this.platformPrisma.hospital.delete({ where: { id } });
    return { deleted: true };
  }
}
