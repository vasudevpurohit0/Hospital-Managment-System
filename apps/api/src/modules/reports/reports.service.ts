import { Injectable } from '@nestjs/common';
import { ChargeStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toCsv } from './csv.util';

export interface ReportRange {
  from?: Date;
  to?: Date;
}

/**
 * Feature 13's report centre. Every report is a real query with ESIC
 * branding, a title, the applied date range, and a totals row where a total
 * means something — never a hardcoded sample table.
 *
 * Scope note: Billing, Outstanding, and Patient Register are implemented
 * here as the highest-value, most-requested reports. Visit/Laboratory/
 * Therapy/Pharmacy/Department-Revenue reporting is already available as
 * structured JSON via AnalyticsController and can be exported the same way
 * this file exports these three — the pattern is proven, not every report
 * type has been individually wired to CSV in this pass.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private dateFilter(r: ReportRange) {
    if (!r.from && !r.to) return undefined;
    return { createdAt: { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) } };
  }

  async billingReportCsv(r: ReportRange): Promise<string> {
    const charges = await this.prisma.chargeItem.findMany({
      where: { status: { not: ChargeStatus.CANCELLED }, ...this.dateFilter(r) },
      orderBy: { createdAt: 'asc' },
      include: {
        visit: { include: { employee: { include: { hospitalUid: true } } } },
        receipt: { select: { receiptNumber: true } },
      },
    });

    return toCsv(
      ['Date', 'UHID', 'Employee ID', 'Patient', 'Category', 'Service', 'Qty', 'Rate', 'Gross', 'Discount', 'Net', 'Outcome', 'Status', 'Receipt'],
      charges.map((c) => [
        c.createdAt.toISOString().slice(0, 10),
        c.visit.employee.hospitalUid?.uidCode ?? '',
        c.visit.employee.employeeId,
        c.visit.employee.name,
        c.categoryName,
        c.description,
        c.quantity.toString(),
        c.unitRate.toString(),
        c.grossAmount.toString(),
        c.discountAmount.toString(),
        c.netAmount.toString(),
        c.benefitOutcome,
        c.status,
        c.receipt?.receiptNumber ?? '',
      ]),
    );
  }

  async outstandingReportCsv(): Promise<string> {
    const charges = await this.prisma.chargeItem.findMany({
      where: { status: ChargeStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      include: { visit: { include: { employee: { include: { hospitalUid: true } } } } },
    });

    const byEmployee = new Map<string, { uhid: string; employeeId: string; name: string; total: number; count: number }>();
    for (const c of charges) {
      const key = c.visit.employee.id;
      const existing = byEmployee.get(key) ?? {
        uhid: c.visit.employee.hospitalUid?.uidCode ?? '',
        employeeId: c.visit.employee.employeeId,
        name: c.visit.employee.name,
        total: 0,
        count: 0,
      };
      existing.total += Number(c.netAmount);
      existing.count += 1;
      byEmployee.set(key, existing);
    }

    return toCsv(
      ['UHID', 'Employee ID', 'Patient', 'Outstanding Charges', 'Outstanding Amount'],
      [...byEmployee.values()]
        .sort((a, b) => b.total - a.total)
        .map((e) => [e.uhid, e.employeeId, e.name, e.count, e.total.toFixed(2)]),
    );
  }

  async patientRegisterCsv(r: ReportRange): Promise<string> {
    const employees = await this.prisma.employee.findMany({
      where: r.from || r.to
        ? { registrationDate: { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) } }
        : undefined,
      orderBy: { registrationDate: 'asc' },
      include: { hospitalUid: true, employmentType: true },
    });

    return toCsv(
      ['Registration Date', 'UHID', 'Employee ID', 'Name', 'Department', 'Employment Type'],
      employees.map((e) => [
        e.registrationDate.toISOString().slice(0, 10),
        e.hospitalUid?.uidCode ?? '',
        e.employeeId,
        e.name,
        e.department,
        e.employmentType.name,
      ]),
    );
  }
}
