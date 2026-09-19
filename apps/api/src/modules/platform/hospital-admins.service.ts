import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { TenantUserProvisioningService } from '../../common/tenant/tenant-user-provisioning.service';
import { recordPlatformAuditLog } from '../../common/tenant/platform-audit.util';
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
}
