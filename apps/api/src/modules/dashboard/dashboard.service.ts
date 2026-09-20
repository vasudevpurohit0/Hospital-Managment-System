import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OpdService } from '../opd/services/opd.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CRITICAL_ALERT_WINDOW_DAYS, EARLY_WARNING_WINDOW_DAYS, daysFromNow } from '../../common/inventory/expiry-window.const';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private prisma: PrismaService,
    private opdService: OpdService,
  ) {}

  /**
   * Strictly read-only aggregate metrics for executive admin dashboard.
   * Produces zero database write side effects.
   *
   * `opd`/`ipd`/`inventory`/`procurement` are operational counts every role
   * with a Dashboard screen legitimately needs (see the controller's own
   * comment on why this endpoint can't gate on Employee:read). `billing`,
   * `auditExceptions`, and `staff` are admin-tier figures (revenue,
   * audit-log contents, headcount) that have no business being visible to
   * e.g. a Pharmacist or Reception -- those three sections are only included
   * when the caller holds `Analytics:read` (the same permission that gates
   * the dedicated Analytics screen) or is the platform Super Admin.
   */
  async getMetrics(user: AuthenticatedUser) {
    const now = new Date();
    const in30Days = daysFromNow(CRITICAL_ALERT_WINDOW_DAYS, now);
    const in90Days = daysFromNow(EARLY_WARNING_WINDOW_DAYS, now);

    const [
      totalOpdVisits,
      openOpdVisits,
      totalAdmissions,
      activeAdmissions,
      totalBeds,
      occupiedBeds,
      lowStockBatches,
      expiring30DaysBatches,
      expiring90DaysBatches,
      quarantinedBatches,
      pendingRequisitions,
      approvedRequisitions,
      openPurchaseOrders,
      totalBillingTransactions,
      paidBillingTransactions,
      auditLogsCount,
      categoryGroups,
      permanentTransactionCount,
      contractualTransactionCount,
      recentAuditLogs,
      totalEmployees,
      employeesAddedToday,
    ] = await Promise.all([
      this.prisma.visit.count({ where: { type: 'OPD' } }),
      this.prisma.visit.count({ where: { type: 'OPD', status: 'OPEN' } }),
      this.prisma.admission.count(),
      this.prisma.admission.count({
        where: { status: { in: ['ALLOCATED', 'UNDER_TREATMENT'] } },
      }),
      this.prisma.bed.count(),
      this.prisma.bed.count({ where: { status: 'OCCUPIED' } }),
      this.prisma.medicineBatch.count({
        where: { currentStock: { lte: 100 }, stockStatus: 'IN_STOCK' },
      }),
      this.prisma.medicineBatch.count({
        where: { expiryDate: { lte: in30Days, gt: now }, stockStatus: 'CRITICAL_ALERT' },
      }),
      this.prisma.medicineBatch.count({
        where: { expiryDate: { lte: in90Days, gt: in30Days } },
      }),
      this.prisma.medicineBatch.count({
        where: { stockStatus: { in: ['EXPIRED', 'QUARANTINED'] } },
      }),
      this.prisma.purchaseRequisition.count({ where: { status: 'PENDING' } }),
      this.prisma.purchaseRequisition.count({ where: { status: 'APPROVED' } }),
      this.prisma.purchaseOrder.count({ where: { status: { in: ['ISSUED', 'DISPATCHED'] } } }),
      // Reads ChargeItem, not the retired BillingTransaction: pharmacy (and
      // every other module) has posted charges there exclusively since P2 —
      // BillingTransaction stopped growing, so counting it here would have
      // frozen this whole section at its pre-P2 values.
      this.prisma.chargeItem.count({ where: { status: { not: 'CANCELLED' } } }),
      this.prisma.chargeItem.count({ where: { status: 'PAID' } }),
      this.prisma.auditLog.count(),
      this.prisma.admission.groupBy({
        by: ['eligibleCategory'],
        where: { status: { in: ['ALLOCATED', 'UNDER_TREATMENT'] } },
        _count: { _all: true },
      }),
      this.prisma.chargeItem.count({
        where: {
          status: { not: 'CANCELLED' },
          visit: { employee: { employmentType: { code: 'PERMANENT' } } },
        },
      }),
      this.prisma.chargeItem.count({
        where: {
          status: { not: 'CANCELLED' },
          visit: { employee: { employmentType: { code: 'CONTRACTUAL' } } },
        },
      }),
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, action: true, entityType: true, entityId: true },
      }),
      this.prisma.employee.count(),
      this.prisma.employee.count({
        where: { registrationDate: { gte: new Date(now.toDateString()) } },
      }),
    ]);

    const bedOccupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;
    const utilizationTotal = permanentTransactionCount + contractualTransactionCount;

    const operational = {
      opd: {
        totalVisits: totalOpdVisits,
        waitingQueue: openOpdVisits,
      },
      ipd: {
        totalAdmissions,
        activeAdmissions,
        totalBeds,
        occupiedBeds,
        availableBeds: Math.max(0, totalBeds - occupiedBeds),
        bedOccupancyRate: Number(bedOccupancyRate.toFixed(1)),
        categorySplit: categoryGroups.map((g) => ({
          category: g.eligibleCategory,
          count: g._count._all,
        })),
      },
      inventory: {
        lowStockAlerts: lowStockBatches,
        expiring30Days: expiring30DaysBatches,
        expiring90Days: expiring90DaysBatches,
        quarantinedBatches,
        estimatedQuarantinedValue: quarantinedBatches * 150.0,
      },
      procurement: {
        pendingRequisitions,
        approvedRequisitions,
        openPurchaseOrders,
        delayedSuppliers: 0,
      },
    };

    const canSeeAdminMetrics =
      user.type === 'platform' ||
      user.permissions?.some(
        (p) => (p.resource === '*' || p.resource === 'Analytics') && (p.action === '*' || p.action === 'read'),
      );
    if (!canSeeAdminMetrics) return operational;

    return {
      ...operational,
      billing: {
        totalTransactions: totalBillingTransactions,
        paidTransactions: paidBillingTransactions,
        permanentUtilizationPct:
          utilizationTotal > 0
            ? Number(((permanentTransactionCount / utilizationTotal) * 100).toFixed(1))
            : 0,
        contractualUtilizationPct:
          utilizationTotal > 0
            ? Number(((contractualTransactionCount / utilizationTotal) * 100).toFixed(1))
            : 0,
      },
      auditExceptions: {
        count: auditLogsCount,
        recentExceptions: recentAuditLogs.map((log) => ({
          id: log.id,
          action: log.action,
          detail: `${log.entityType} ${log.entityId}`,
        })),
      },
      staff: {
        totalEmployees,
        employeesAddedToday,
      },
    };
  }

  /**
   * A lean, role-keyed personal summary -- a handful of real counts plus
   * quick-link targets into the role's existing full workspace screen, never
   * a re-implementation of that screen's own logic. Reuses OpdService for
   * the doctor's queue (the same ACTIVE_STATUSES semantics that service
   * already owns) and plain counts for everything else, since a count has
   * no business logic worth centralizing a second time.
   */
  async getMySummary(user: AuthenticatedUser) {
    const startOfToday = new Date(new Date().toDateString());

    switch (user.roleName) {
      case 'Doctor': {
        const [queue, pendingPrescriptionDrafts] = await Promise.all([
          this.opdService.getMyQueue(user.id),
          this.prisma.prescription.count({ where: { doctorId: user.id, status: 'DRAFT' } }),
        ]);
        return {
          role: 'Doctor',
          waitingCount: queue.filter((v) => v.status === 'WAITING').length,
          calledCount: queue.filter((v) => v.status === 'CALLED' || v.status === 'IN_CONSULTATION').length,
          pendingPrescriptionDrafts,
        };
      }

      case 'Nurse': {
        const [assignedAdmissions, recentNotes] = await Promise.all([
          this.prisma.admission.count({ where: { assignedNurseId: user.id, status: 'UNDER_TREATMENT' } }),
          this.prisma.admissionNote.count({
            where: { admission: { assignedNurseId: user.id }, createdAt: { gte: startOfToday } },
          }),
        ]);
        return { role: 'Nurse', assignedAdmissions, notesToday: recentNotes };
      }

      case 'Reception': {
        const [todayOpdVisits, waitingQueue] = await Promise.all([
          this.prisma.visit.count({ where: { type: 'OPD', createdAt: { gte: startOfToday } } }),
          this.prisma.visit.count({ where: { type: 'OPD', status: 'OPEN' } }),
        ]);
        return { role: 'Reception', todayOpdVisits, waitingQueue };
      }

      case 'Pharmacist': {
        const [pendingQueue, lowStock] = await Promise.all([
          this.prisma.prescription.count({ where: { status: { in: ['SIGNED', 'PARTIALLY_DISPENSED'] } } }),
          this.countLowStockBatches(),
        ]);
        return { role: 'Pharmacist', pendingQueue, lowStock };
      }

      case 'LabTechnician': {
        const pendingCounts = await this.prisma.labOrder.groupBy({
          by: ['status'],
          where: { status: { in: ['ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING'] } },
          _count: { _all: true },
        });
        return {
          role: 'LabTechnician',
          pendingCollection: pendingCounts.find((g) => g.status === 'ORDERED')?._count._all ?? 0,
          inProgress: pendingCounts
            .filter((g) => g.status === 'SAMPLE_COLLECTED' || g.status === 'PROCESSING')
            .reduce((sum, g) => sum + g._count._all, 0),
        };
      }

      case 'Pathologist': {
        const [awaitingVerification, criticalUnverified] = await Promise.all([
          this.prisma.labOrder.count({ where: { status: 'RESULT_ENTERED' } }),
          this.prisma.labResult.count({
            where: {
              flag: 'CRITICAL',
              labOrderItem: { labOrder: { status: { notIn: ['VERIFIED', 'REPORTED', 'CANCELLED'] } } },
            },
          }),
        ]);
        return { role: 'Pathologist', awaitingVerification, criticalUnverified };
      }

      case 'AdmissionDesk': {
        const [pendingRequests, availableBeds] = await Promise.all([
          this.prisma.admission.count({ where: { status: { in: ['REQUESTED', 'ELIGIBILITY_CHECKED'] } } }),
          this.prisma.bed.count({ where: { status: 'AVAILABLE' } }),
        ]);
        return { role: 'AdmissionDesk', pendingRequests, availableBeds };
      }

      case 'QueueManager': {
        const waiting = await this.prisma.oPDVisit.count({ where: { status: 'WAITING' } });
        return { role: 'QueueManager', waitingAcrossDepartments: waiting };
      }

      case 'StoreManager': {
        const [lowStock, openRequisitions] = await Promise.all([
          this.countLowStockBatches(),
          this.prisma.purchaseRequisition.count({ where: { status: 'PENDING' } }),
        ]);
        return { role: 'StoreManager', lowStock, openRequisitions };
      }

      case 'ProcurementOfficer': {
        const [awaitingApproval, openPOsAwaitingGRN] = await Promise.all([
          this.prisma.purchaseRequisition.count({ where: { status: 'PENDING' } }),
          this.prisma.purchaseOrder.count({ where: { status: { in: ['ISSUED', 'DISPATCHED'] } } }),
        ]);
        return { role: 'ProcurementOfficer', awaitingApproval, openPOsAwaitingGRN };
      }

      case 'DataEntryOperator': {
        const employeesAddedToday = await this.prisma.employee.count({
          where: { registrationDate: { gte: startOfToday } },
        });
        return { role: 'DataEntryOperator', employeesAddedToday };
      }

      // A platform Super Admin inside a hospital (X-Hospital-Id) has no
      // tenant user row, but sees the hospital through admin eyes -- the
      // Administrator block below is pure aggregates with no user.id
      // filtering, so it is safe to share rather than returning an empty
      // `{ role: 'SuperAdmin' }` that leaves the dashboard blank.
      case 'SuperAdmin':
      case 'Administrator': {
        const [
          staffByRole,
          activeStaff,
          inactiveStaff,
          recentAuditLogs,
          failedLoginRelatedToday,
          passwordResetsToday,
        ] = await Promise.all([
          this.prisma.user.groupBy({ by: ['roleId'], _count: { _all: true } }),
          this.prisma.user.count({ where: { active: true } }),
          this.prisma.user.count({ where: { active: false } }),
          this.prisma.auditLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: { id: true, action: true, actorRole: true, entityType: true, entityId: true, createdAt: true },
          }),
          this.prisma.auditLog.count({
            where: { action: { in: ['auth.password_changed', 'auth.password_reset_via_token'] }, createdAt: { gte: startOfToday } },
          }),
          this.prisma.auditLog.count({
            where: { action: { in: ['doctor.password_reset', 'staff.password_reset'] }, createdAt: { gte: startOfToday } },
          }),
        ]);
        return {
          role: 'Administrator',
          totalStaff: activeStaff + inactiveStaff,
          activeStaff,
          inactiveStaff,
          staffRoleGroupCount: staffByRole.length,
          recentActivity: recentAuditLogs,
          securityEventsToday: failedLoginRelatedToday + passwordResetsToday,
        };
      }

      default:
        return { role: user.roleName };
    }
  }

  /**
   * Prisma's fluent `where` has no field-to-field comparison operator, so
   * this counts at the database with a raw SQL `COUNT`, not by pulling every
   * batch's `current_stock`/`reorder_level` pair into Node and filtering
   * in-process (which used to fetch every row in the table, unbounded, on
   * every dashboard load, for a comparison the database itself can do in
   * one pass).
   */
  private async countLowStockBatches(): Promise<number> {
    const [{ count }] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM medicine_batches
      WHERE current_stock <= reorder_level
    `;
    return Number(count);
  }
}
