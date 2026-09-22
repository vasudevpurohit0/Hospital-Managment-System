import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { TenantUserProvisioningService } from '../../common/tenant/tenant-user-provisioning.service';
import { LoginDirectoryService } from '../../common/tenant/login-directory.service';
import { recordPlatformAuditLog } from '../../common/tenant/platform-audit.util';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { AuthService } from '../auth/auth.service';
import { CreateHospitalAdminDto } from './dto/create-hospital-admin.dto';

export interface HospitalAdminRecord {
  id: string;
  identifier: string;
  active: boolean;
  hospitalId: string;
  hospitalName: string;
  hospitalSlug: string;
}

/**
 * Cross-hospital roster of every hospital-local Administrator on the
 * platform. Unlike PlatformAdminsService (global Super Admins, one table in
 * `public`), an "Administrator" is a row inside each hospital's own schema --
 * there is no single table to query, so this fans out over every
 * non-PROVISIONING hospital the same way PlatformDashboardService does,
 * tagging each result with which hospital it came from.
 */
@Injectable()
export class HospitalAdminsService {
  private readonly logger = new Logger(HospitalAdminsService.name);

  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly tenantClients: TenantClientFactory,
    private readonly userProvisioning: TenantUserProvisioningService,
    private readonly loginDirectory: LoginDirectoryService,
    private readonly authService: AuthService,
  ) {}

  private async requireOnboardedHospital(id: string) {
    const hospital = await this.platformPrisma.hospital.findUnique({ where: { id } });
    if (!hospital) throw new NotFoundException(`Hospital not found: ${id}`);
    if (hospital.status === 'PROVISIONING') {
      throw new BadRequestException('This hospital is still provisioning and has no schema to add an admin to yet.');
    }
    return hospital;
  }

  async list(): Promise<HospitalAdminRecord[]> {
    const hospitals = await this.platformPrisma.hospital.findMany({
      where: { status: { not: 'PROVISIONING' } },
      orderBy: { name: 'asc' },
    });

    const perHospital = await Promise.all(
      hospitals.map(async (hospital): Promise<HospitalAdminRecord[]> => {
        try {
          const client = await this.tenantClients.getClient(hospital.schemaName);
          const admins = await client.user.findMany({
            where: { role: { name: 'Administrator' } },
            select: { id: true, identifier: true, active: true },
            orderBy: { identifier: 'asc' },
          });
          return admins.map((a) => ({
            ...a,
            hospitalId: hospital.id,
            hospitalName: hospital.name,
            hospitalSlug: hospital.slug,
          }));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to load admins for hospital "${hospital.slug}": ${message}`);
          return [];
        }
      }),
    );

    return perHospital.flat();
  }

  async create(hospitalId: string, dto: CreateHospitalAdminDto, platformUserId: string): Promise<HospitalAdminRecord> {
    const hospital = await this.requireOnboardedHospital(hospitalId);
    const user = await this.userProvisioning.provisionAdministrator(
      hospital.schemaName,
      hospital.id,
      dto.identifier,
      dto.password,
    );
    await recordPlatformAuditLog(this.platformPrisma, {
      platformUserId,
      action: 'hospital_admin.create',
      hospitalId: hospital.id,
      resource: 'User',
      metadata: { identifier: user.identifier },
    });
    return {
      id: user.id,
      identifier: user.identifier,
      active: true,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      hospitalSlug: hospital.slug,
    };
  }

  /**
   * Activates or deactivates one hospital's Administrator account. Mirrors
   * PlatformAdminsService.setActive()'s last-admin-standing guard: a hospital
   * can never be left with zero active Administrators from here, since that
   * would lock out the one role that could otherwise fix it from inside the
   * hospital itself.
   */
  async setActive(hospitalId: string, userId: string, active: boolean, platformUserId: string): Promise<HospitalAdminRecord> {
    const hospital = await this.requireOnboardedHospital(hospitalId);
    const client = await this.tenantClients.getClient(hospital.schemaName);

    const existing = await client.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!existing || existing.role.name !== 'Administrator') {
      throw new NotFoundException(`No Administrator with id "${userId}" found in ${hospital.name}.`);
    }

    if (!active) {
      const activeCount = await client.user.count({
        where: { role: { name: 'Administrator' }, active: true },
      });
      if (activeCount <= 1) {
        throw new BadRequestException(`Cannot deactivate the only remaining active Administrator in ${hospital.name}.`);
      }
    }

    const user = await client.user.update({ where: { id: userId }, data: { active } });
    await recordPlatformAuditLog(this.platformPrisma, {
      platformUserId,
      action: active ? 'hospital_admin.activate' : 'hospital_admin.deactivate',
      hospitalId: hospital.id,
      resource: 'User',
      metadata: { identifier: user.identifier },
    });
    return {
      id: user.id,
      identifier: user.identifier,
      active: user.active,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      hospitalSlug: hospital.slug,
    };
  }

  /**
   * Only a Super Admin can reach this (route is behind PlatformOnlyGuard),
   * completing the impersonation chain AccountLifecycleService.impersonate()
   * already guards for but could never reach on its own: that method refuses
   * an Administrator target unless `actor.type === 'platform'`, but neither
   * StaffService nor DoctorService's target lookup ever returns an
   * Administrator-role user, so there was no route that could actually land
   * a Super Admin on a Hospital Admin's session. This is that route --
   * same eligibility rules (active, not mid first-login setup, not locked),
   * same `issueImpersonationSession()`/audit-log machinery, just entered from
   * the cross-hospital admin roster instead of one hospital's own tenant
   * context (this hospital is resolved from the URL, not the caller's
   * session, since a Super Admin has no "own" tenant to begin with).
   */
  async impersonate(
    hospitalId: string,
    userId: string,
    platformUser: { id: string; identifier: string },
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<{ accessToken: string; expiresIn: string; target: { id: string; identifier: string; role: string; name: string } }> {
    const hospital = await this.requireOnboardedHospital(hospitalId);
    const client = await this.tenantClients.getClient(hospital.schemaName);

    return runWithTenant({ hospitalId: hospital.id, schemaName: hospital.schemaName, prismaClient: client }, async () => {
      const target = await client.user.findUnique({
        where: { id: userId },
        include: { role: true, employee: { select: { name: true } } },
      });
      if (!target || target.role?.name !== 'Administrator') {
        throw new NotFoundException(`No Administrator with id "${userId}" found in ${hospital.name}.`);
      }
      if (!target.role) {
        throw new InternalServerErrorException('Target account is not fully configured.');
      }
      if (!target.active) {
        throw new BadRequestException('Cannot impersonate a deactivated account.');
      }
      if (target.mustChangePassword) {
        throw new BadRequestException('Cannot impersonate an account that has not completed first-login setup yet.');
      }
      await this.loginDirectory.checkLock(target.identifier);

      const session = await this.authService.issueImpersonationSession({
        target: {
          id: target.id,
          identifier: target.identifier,
          roleId: target.roleId,
          roleName: target.role.name,
          tokenVersion: target.tokenVersion,
        },
        hospitalId: hospital.id,
        schemaName: hospital.schemaName,
        impersonator: {
          id: platformUser.id,
          identifier: platformUser.identifier,
          roleName: 'SuperAdmin',
          type: 'platform',
        },
        meta,
      });

      return {
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
        target: {
          id: target.id,
          identifier: target.identifier,
          role: target.role.name,
          name: target.employee?.name ?? target.identifier,
        },
      };
    });
  }
}
