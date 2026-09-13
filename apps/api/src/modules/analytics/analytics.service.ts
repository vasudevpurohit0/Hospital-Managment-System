import { Injectable } from '@nestjs/common';
import { ChargeStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface DateRange {
  from?: Date;
  to?: Date;
}

/**
 * Feature 12/22: every number here comes from a real aggregate query against
 * the live database, date-ranged where a range means anything. Nothing is a
 * hardcoded placeholder — an empty database returns real zeros, not sample
 * data dressed up as a dashboard.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private range(r: DateRange, field = 'createdAt') {
    if (!r.from && !r.to) return undefined;
    return { [field]: { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) } };
  }

  async operations(r: DateRange) {
    const dateFilter = this.range(r);

    const [
      registrations,
      opdVisits,
      opdByDepartment,
      admissions,
      discharges,
      totalBeds,
      occupiedBeds,
      labOrders,
      labByStatus,
      therapySessions,
      pharmacyDispenses,
    ] = await Promise.all([
      this.prisma.employee.count({ where: this.range(r, 'registrationDate') }),
      this.prisma.visit.count({ where: { type: 'OPD', ...dateFilter } }),
      this.prisma.oPDVisit.groupBy({
        by: ['departmentId'],
        where: dateFilter,
        _count: { _all: true },
      }),
      this.prisma.admission.count({ where: this.range(r, 'requestedAt') }),
      this.prisma.admission.count({ where: { status: 'DISCHARGED', ...this.range(r, 'dischargedAt') } }),
      this.prisma.bed.count(),
      this.prisma.bed.count({ where: { status: 'OCCUPIED' } }),
      this.prisma.labOrder.count({ where: dateFilter }),
      this.prisma.labOrder.groupBy({ by: ['status'], where: dateFilter, _count: { _all: true } }),
      this.prisma.therapySession.count({ where: { status: 'PERFORMED', ...this.range(r, 'performedAt') } }),
      this.prisma.chargeItem.count({
        where: { prescriptionItemId: { not: null }, status: { not: 'CANCELLED' }, ...dateFilter },
      }),
    ]);

    const departments = await this.prisma.department.findMany({
      where: { id: { in: opdByDepartment.map((d) => d.departmentId) } },
    });
    const deptName = new Map(departments.map((d) => [d.id, d.name]));

    return {
      registrations,
      opd: {
        totalVisits: opdVisits,
        byDepartment: opdByDepartment.map((d) => ({
          department: deptName.get(d.departmentId) ?? 'Unknown',
          count: d._count._all,
        })),
      },
      ipd: {
        admissions,
        discharges,
        totalBeds,
        occupiedBeds,
        occupancyRate: totalBeds > 0 ? Number(((occupiedBeds / totalBeds) * 100).toFixed(1)) : 0,
      },
      laboratory: {
        totalOrders: labOrders,
        byStatus: labByStatus.map((s) => ({ status: s.status, count: s._count._all })),
      },
      therapy: { sessionsPerformed: therapySessions },
      pharmacy: { dispenseCount: pharmacyDispenses },
    };
  }

  async clinical(r: DateRange) {
    const dateFilter = this.range(r);

    const [totalLabOrders, verifiedReports, pendingVerification, avgTurnaroundRows, abnormalResults] =
      await Promise.all([
        this.prisma.labOrder.count({ where: dateFilter }),
        this.prisma.labReport.count({ where: this.range(r, 'releasedAt') }),
        this.prisma.labOrder.count({ where: { status: 'RESULT_ENTERED', ...dateFilter } }),
        this.prisma.$queryRaw<{ avg_hours: number | null }[]>`
          SELECT AVG(EXTRACT(EPOCH FROM (lr.released_at - ls.collected_at)) / 3600.0) AS avg_hours
          FROM lab_reports lr
          JOIN lab_samples ls ON ls.lab_order_id = lr.lab_order_id
        `,
        this.prisma.labResult.count({ where: { flag: { not: 'NORMAL' } } }),
      ]);

    return {
      laboratory: {
        totalOrders: totalLabOrders,
        verifiedReports,
        pendingVerification,
        averageTurnaroundHours: avgTurnaroundRows[0]?.avg_hours
          ? Number(Number(avgTurnaroundRows[0].avg_hours).toFixed(1))
          : null,
        abnormalResultCount: abnormalResults,
      },
    };
  }

  async financial(r: DateRange) {
    const dateFilter = this.range(r);
    const notCancelled = { status: { not: ChargeStatus.CANCELLED } as const, ...dateFilter };

    const [totals, byStatus, byCategory, byServiceType] = await Promise.all([
      this.prisma.chargeItem.aggregate({
        where: notCancelled,
        _sum: { netAmount: true },
      }),
      this.prisma.chargeItem.groupBy({
        by: ['status'],
        where: dateFilter,
        _sum: { netAmount: true },
        _count: { _all: true },
      }),
      this.prisma.chargeItem.groupBy({
        by: ['categoryName'],
        where: notCancelled,
        _sum: { netAmount: true },
        _count: { _all: true },
      }),
      this.prisma.chargeItem.groupBy({
        by: ['serviceId'],
        where: { ...notCancelled, serviceId: { not: null } },
        _sum: { netAmount: true },
        _count: { _all: true },
        orderBy: { _sum: { netAmount: 'desc' } },
        take: 10,
      }),
    ]);

    const services = await this.prisma.service.findMany({
      where: { id: { in: byServiceType.map((s) => s.serviceId).filter((id): id is string => !!id) } },
      select: { id: true, name: true, code: true },
    });
    const serviceName = new Map(services.map((s) => [s.id, s]));

    const paid = byStatus.find((s) => s.status === 'PAID');
    const pending = byStatus.find((s) => s.status === 'PENDING');

    return {
      // No discount in this system: total is the straight sum of quantity × rate.
      totalAmount: (totals._sum.netAmount ?? 0).toString(),
      paidAmount: (paid?._sum.netAmount ?? 0).toString(),
      outstandingAmount: (pending?._sum.netAmount ?? 0).toString(),
      byCategory: byCategory
        .map((c) => ({
          category: c.categoryName,
          amount: (c._sum.netAmount ?? 0).toString(),
          count: c._count._all,
        }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
      topServicesByRevenue: byServiceType.map((s) => ({
        service: serviceName.get(s.serviceId!)?.name ?? 'Unknown',
        code: serviceName.get(s.serviceId!)?.code ?? '',
        amount: (s._sum.netAmount ?? 0).toString(),
        count: s._count._all,
      })),
    };
  }

  async inventory() {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const [lowStock, outOfStock, expiring30, expiring90, expired, pendingRequisitions, openPOs] =
      await Promise.all([
        this.prisma.medicineBatch.count({ where: { stockStatus: { in: ['EARLY_WARNING', 'CRITICAL_ALERT'] } } }),
        this.prisma.medicineBatch.count({ where: { currentStock: 0 } }),
        this.prisma.medicineBatch.count({ where: { expiryDate: { lte: in30Days, gt: now } } }),
        this.prisma.medicineBatch.count({ where: { expiryDate: { lte: in90Days, gt: in30Days } } }),
        this.prisma.medicineBatch.count({ where: { stockStatus: 'EXPIRED' } }),
        this.prisma.purchaseRequisition.count({ where: { status: 'PENDING' } }),
        this.prisma.purchaseOrder.count({ where: { status: { in: ['ISSUED', 'DISPATCHED'] } } }),
      ]);

    return {
      lowStockBatches: lowStock,
      outOfStockBatches: outOfStock,
      expiringWithin30Days: expiring30,
      expiringWithin90Days: expiring90,
      expiredBatches: expired,
      procurement: { pendingRequisitions, openPurchaseOrders: openPOs },
    };
  }
}
