import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { AuditLogService, AuditLogFilters } from '../audit/audit-log.service';
import { toCsv } from '../reports/csv.util';

/** Cap on how many rows a cross-hospital (no hospitalId given) pull returns -- a deliberate, documented scale limit, not real per-hospital pagination. Picking one hospital gets full pagination via AuditLogService directly. */
const CROSS_HOSPITAL_ROW_CAP = 200;
const PER_HOSPITAL_PULL = 50;
/** Same idea as CROSS_HOSPITAL_ROW_CAP, but for an export: bigger, since a CSV pull is a deliberate one-off, not a paged UI. */
const CROSS_HOSPITAL_EXPORT_CAP = 5000;
const PER_HOSPITAL_EXPORT_PULL = 500;

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

  /** Backs the stat cards on the Staff Activity Log screen -- same shape as AuditLogService.getStats(), summed across every active hospital when none is picked. */
  async getStats(filters: { hospitalId?: string }) {
    if (filters.hospitalId) {
      const hospital = await this.platformPrisma.hospital.findUnique({ where: { id: filters.hospitalId } });
      if (!hospital || hospital.status !== 'ACTIVE') {
        throw new NotFoundException('Hospital not found or not active.');
      }
      const client = await this.tenantClients.getClient(hospital.schemaName);
      return runWithTenant({ hospitalId: hospital.id, schemaName: hospital.schemaName, prismaClient: client }, () =>
        this.auditLogService.getStats(),
      );
    }

    const hospitals = await this.platformPrisma.hospital.findMany({ where: { status: 'ACTIVE' } });
    const perHospital = await Promise.all(
      hospitals.map(async (hospital) => {
        try {
          const client = await this.tenantClients.getClient(hospital.schemaName);
          return await runWithTenant(
            { hospitalId: hospital.id, schemaName: hospital.schemaName, prismaClient: client },
            () => this.auditLogService.getStats(),
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to load activity log stats for hospital "${hospital.slug}": ${message}`);
          return { total: 0, last24h: 0, critical: 0, failedLogins: 0 };
        }
      }),
    );

    return perHospital.reduce(
      (acc, s) => ({
        total: acc.total + s.total,
        last24h: acc.last24h + s.last24h,
        critical: acc.critical + s.critical,
        failedLogins: acc.failedLogins + s.failedLogins,
      }),
      { total: 0, last24h: 0, critical: 0, failedLogins: 0 },
    );
  }

  /** Same filters as getStaffAuditLog(), rendered as one combined CSV (with an added "Hospital" column) instead of a per-hospital file. */
  async exportCsv(filters: StaffAuditFilters): Promise<string> {
    if (filters.hospitalId) {
      const hospital = await this.platformPrisma.hospital.findUnique({ where: { id: filters.hospitalId } });
      if (!hospital || hospital.status !== 'ACTIVE') {
        throw new NotFoundException('Hospital not found or not active.');
      }
      const client = await this.tenantClients.getClient(hospital.schemaName);
      const rows = await runWithTenant(
        { hospitalId: hospital.id, schemaName: hospital.schemaName, prismaClient: client },
        () => this.auditLogService.findRowsForExport(filters, CROSS_HOSPITAL_EXPORT_CAP),
      );
      return this.renderCsv(rows.map((r) => ({ ...r, hospitalName: hospital.name })));
    }

    const hospitals = await this.platformPrisma.hospital.findMany({ where: { status: 'ACTIVE' } });
    const perHospital = await Promise.all(
      hospitals.map(async (hospital) => {
        try {
          const client = await this.tenantClients.getClient(hospital.schemaName);
          const rows = await runWithTenant(
            { hospitalId: hospital.id, schemaName: hospital.schemaName, prismaClient: client },
            () => this.auditLogService.findRowsForExport(filters, PER_HOSPITAL_EXPORT_PULL),
          );
          return rows.map((r) => ({ ...r, hospitalName: hospital.name }));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to export activity log for hospital "${hospital.slug}": ${message}`);
          return [];
        }
      }),
    );

    const merged = perHospital
      .flat()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, CROSS_HOSPITAL_EXPORT_CAP);

    return this.renderCsv(merged);
  }

  private renderCsv(
    rows: (Awaited<ReturnType<AuditLogService['findRowsForExport']>>[number] & { hospitalName: string })[],
  ): string {
    return toCsv(
      ['Timestamp', 'Hospital', 'Actor', 'Staff ID', 'Role', 'Impersonated By', 'Action', 'Module', 'Record ID', 'Status', 'Severity', 'IP Address', 'Browser', 'OS', 'Description', 'Reason'],
      rows.map((r) => [
        r.createdAt.toISOString(),
        r.hospitalName,
        r.actorUser?.identifier ?? r.actorUser?.employee?.name ?? 'System',
        r.actorUser?.employee?.employeeId ?? '',
        r.actorRole,
        r.impersonatorRoleLabel ?? '',
        r.action,
        r.entityType,
        r.entityId,
        r.status,
        r.severity,
        r.ipAddress ?? '',
        r.browser ?? '',
        r.os ?? '',
        r.description ?? '',
        r.reason ?? '',
      ]),
    );
  }
}
