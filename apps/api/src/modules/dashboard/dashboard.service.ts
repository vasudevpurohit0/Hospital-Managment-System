import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Strictly read-only aggregate metrics for executive admin dashboard.
   * Produces zero database write side effects.
   */
  async getMetrics() {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

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
      this.prisma.billingTransaction.count(),
      this.prisma.billingTransaction.count({ where: { outcome: 'PAID' } }),
      this.prisma.auditLog.count(),
      this.prisma.admission.groupBy({
        by: ['eligibleCategory'],
        where: { status: { in: ['ALLOCATED', 'UNDER_TREATMENT'] } },
        _count: { _all: true },
      }),
      this.prisma.billingTransaction.count({
        where: {
          prescriptionItem: {
            prescription: { visit: { employee: { employmentType: { code: 'PERMANENT' } } } },
          },
        },
      }),
      this.prisma.billingTransaction.count({
        where: {
          prescriptionItem: {
            prescription: { visit: { employee: { employmentType: { code: 'CONTRACTUAL' } } } },
          },
        },
      }),
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, action: true, entityType: true, entityId: true },
      }),
    ]);

    const bedOccupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;
    const utilizationTotal = permanentTransactionCount + contractualTransactionCount;

    return {
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
    };
  }
}
