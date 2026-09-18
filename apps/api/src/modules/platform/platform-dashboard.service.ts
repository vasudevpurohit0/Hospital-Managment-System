import { Injectable, Logger } from '@nestjs/common';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { DashboardService } from '../dashboard/dashboard.service';

export interface HospitalMetrics {
  hospitalId: string;
  hospitalName: string;
  hospitalSlug: string;
  status: string;
  ok: boolean;
  error?: string;
  totalPatients: number;
  todayOpdVisits: number;
  activeAdmissions: number;
  bedOccupancyRate: number;
  lowStockAlerts: number;
  staffCount: number;
  revenueCollected: number;
}

/**
 * Aggregates metrics ACROSS every active hospital -- there is no single
 * shared table to run one query against (each hospital is its own Postgres
 * schema), so this connects to each tenant schema in turn and reuses the
 * existing per-hospital DashboardService for the bulk of the numbers, adding
 * only what that service doesn't already compute (today's OPD count, staff
 * count, revenue sum).
 */
@Injectable()
export class PlatformDashboardService {
  private readonly logger = new Logger(PlatformDashboardService.name);

  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly tenantClients: TenantClientFactory,
    private readonly dashboardService: DashboardService,
  ) {}

  private async getHospitalMetrics(hospital: {
    id: string;
    name: string;
    slug: string;
    schemaName: string;
    status: string;
  }): Promise<HospitalMetrics> {
    const base = {
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      hospitalSlug: hospital.slug,
      status: hospital.status,
    };
    try {
      const client = await this.tenantClients.getClient(hospital.schemaName);
      return await runWithTenant(
        { hospitalId: hospital.id, schemaName: hospital.schemaName, prismaClient: client },
        async () => {
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);

          const [metrics, todayOpdVisits, staffCount, revenue] = await Promise.all([
            this.dashboardService.getMetrics(),
            client.visit.count({ where: { type: 'OPD', createdAt: { gte: startOfToday } } }),
            client.user.count(),
            client.chargeItem.aggregate({ _sum: { netAmount: true }, where: { status: 'PAID' } }),
          ]);

          return {
            ...base,
            ok: true,
            totalPatients: metrics.staff.totalEmployees,
            todayOpdVisits,
            activeAdmissions: metrics.ipd.activeAdmissions,
            bedOccupancyRate: metrics.ipd.bedOccupancyRate,
            lowStockAlerts: metrics.inventory.lowStockAlerts,
            staffCount,
            revenueCollected: Number(revenue._sum.netAmount || 0),
          };
        },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to load metrics for hospital "${hospital.slug}": ${message}`);
      return {
        ...base,
        ok: false,
        error: message,
        totalPatients: 0,
        todayOpdVisits: 0,
        activeAdmissions: 0,
        bedOccupancyRate: 0,
        lowStockAlerts: 0,
        staffCount: 0,
        revenueCollected: 0,
      };
    }
  }

  async getSummary() {
    const hospitals = await this.platformPrisma.hospital.findMany({ orderBy: { createdAt: 'desc' } });
    const activeHospitals = hospitals.filter((h) => h.status === 'ACTIVE');
    const provisioningHospitals = hospitals.filter((h) => h.status === 'PROVISIONING');
    const suspendedHospitals = hospitals.filter((h) => h.status === 'SUSPENDED');

    const perHospital = await Promise.all(activeHospitals.map((h) => this.getHospitalMetrics(h)));

    const totals = perHospital.reduce(
      (acc, h) => ({
        totalPatients: acc.totalPatients + h.totalPatients,
        todayOpdVisits: acc.todayOpdVisits + h.todayOpdVisits,
        activeAdmissions: acc.activeAdmissions + h.activeAdmissions,
        lowStockAlerts: acc.lowStockAlerts + h.lowStockAlerts,
        staffCount: acc.staffCount + h.staffCount,
        revenueCollected: acc.revenueCollected + h.revenueCollected,
      }),
      { totalPatients: 0, todayOpdVisits: 0, activeAdmissions: 0, lowStockAlerts: 0, staffCount: 0, revenueCollected: 0 },
    );

    return {
      hospitalCounts: {
        total: hospitals.length,
        active: activeHospitals.length,
        suspended: suspendedHospitals.length,
        provisioning: provisioningHospitals.length,
      },
      totals,
      perHospital,
      attentionNeeded: {
        stuckProvisioning: provisioningHospitals.map((h) => ({ id: h.id, name: h.name, slug: h.slug, createdAt: h.createdAt })),
        lowStockHospitals: perHospital.filter((h) => h.lowStockAlerts > 0).map((h) => ({
          id: h.hospitalId,
          name: h.hospitalName,
          lowStockAlerts: h.lowStockAlerts,
        })),
        failedToLoad: perHospital.filter((h) => !h.ok).map((h) => ({ id: h.hospitalId, name: h.hospitalName, error: h.error })),
      },
    };
  }
}
