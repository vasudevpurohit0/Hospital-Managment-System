import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { AuditLogService, AuditLogFilters } from '../audit/audit-log.service';

/** Cap on how many rows a cross-hospital (no hospitalId given) pull returns -- a deliberate, documented scale limit, not real per-hospital pagination. Picking one hospital gets full pagination via AuditLogService directly. */
const CROSS_HOSPITAL_ROW_CAP = 200;
const PER_HOSPITAL_PULL = 50;

export interface StaffAuditFilters extends AuditLogFilters {
  hospitalId?: string;
}

/**
 * The cross-hospital counterpart to AuditLogService -- reuses the exact
 * per-hospital-connect-and-tolerate-failure pattern PlatformDashboardService
 * already established, rather than inventing a second way to reach across
 * tenant schemas.
 */
@Injectable()
export class PlatformStaffAuditService {
  private readonly logger = new Logger(PlatformStaffAuditService.name);

  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly tenantClients: TenantClientFactory,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getStaffAuditLog(filters: StaffAuditFilters) {
    if (filters.hospitalId) {
      const hospital = await this.platformPrisma.hospital.findUnique({ where: { id: filters.hospitalId } });
      if (!hospital || hospital.status !== 'ACTIVE') {
        throw new NotFoundException('Hospital not found or not active.');
      }
      const client = await this.tenantClients.getClient(hospital.schemaName);
      return runWithTenant({ hospitalId: hospital.id, schemaName: hospital.schemaName, prismaClient: client }, () =>
        this.auditLogService.findAll(filters),
      );
    }

    const hospitals = await this.platformPrisma.hospital.findMany({ where: { status: 'ACTIVE' } });
    const perHospital = await Promise.all(
      hospitals.map(async (hospital) => {
        try {
          const client = await this.tenantClients.getClient(hospital.schemaName);
          const result = await runWithTenant(
            { hospitalId: hospital.id, schemaName: hospital.schemaName, prismaClient: client },
            () => this.auditLogService.findAll({ ...filters, page: 1, limit: PER_HOSPITAL_PULL }),
          );
          return result.items.map((item) => ({ ...item, hospitalId: hospital.id, hospitalName: hospital.name }));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to load activity log for hospital "${hospital.slug}": ${message}`);
          return [];
        }
      }),
    );

    const merged = perHospital
      .flat()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, CROSS_HOSPITAL_ROW_CAP);

    return {
      items: merged,
      meta: {
        total: merged.length,
        hospitalsSearched: hospitals.length,
        cappedAt: CROSS_HOSPITAL_ROW_CAP,
        note: 'Cross-hospital view is capped, not fully paginated -- pick one hospital for complete results.',
      },
    };
  }
}
