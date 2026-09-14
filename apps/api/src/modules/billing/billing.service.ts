import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Backs the original pharmacy-dispensing billing screen.
 *
 * As of P2, its data comes from ChargeItem rather than the retired
 * BillingTransaction table, but it is deliberately still scoped to
 * pharmacy-origin charges (`prescriptionItemId IS NOT NULL`) so this screen's
 * behaviour and appearance are unchanged. The unified, all-sources ledger that
 * Features 3/4 call for is the new Patient Ledger surface
 * (ChargeController: `GET /patients/:employeeId/ledger`), not this one — this
 * one is kept narrow on purpose rather than partially widened.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private prisma: PrismaService) {}

  async findAllTransactions() {
    const charges = await this.prisma.chargeItem.findMany({
      where: { prescriptionItemId: { not: null } },
      include: {
        prescriptionItem: {
          include: {
            prescription: {
              include: {
                visit: {
                  include: {
                    employee: {
                      include: { employmentType: true, patientProfile: true },
                    },
                  },
                },
              },
            },
          },
        },
        receipt: { select: { id: true, receiptNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return charges.map((c) => ({
      id: c.id,
      prescriptionItemId: c.prescriptionItemId,
      outcome: c.benefitOutcome,
      amount: Number(c.netAmount),
      receiptReference: c.receipt?.receiptNumber ?? null,
      receiptId: c.receipt?.id ?? null,
      createdAt: c.createdAt,
      // Superset fields the legacy BillingTransaction never carried.
      description: c.description,
      categoryName: c.categoryName,
      quantity: c.quantity.toString(),
      unitRate: c.unitRate.toString(),
      grossAmount: c.grossAmount.toString(),
      discountAmount: c.discountAmount.toString(),
      netAmount: c.netAmount.toString(),
      status: c.status,
      prescriptionItem: c.prescriptionItem,
    }));
  }

  /**
   * Takes a ChargeItem id (the frontend still calls this "transactionId",
   * matching what it has always passed here) and renders it as the single-item
   * receipt shape the print view expects.
   */
  async getReceipt(chargeId: string) {
    const charge = await this.prisma.chargeItem.findUnique({
      where: { id: chargeId },
      include: {
        prescriptionItem: true,
        visit: {
          include: {
            employee: { include: { employmentType: true, patientProfile: true } },
          },
        },
        receipt: { select: { id: true, receiptNumber: true } },
      },
    });

    if (!charge) throw new NotFoundException(`Billing transaction not found: ${chargeId}`);

    const emp = charge.visit.employee;
    const branding = await this.prisma.brandingConfig.findUnique({ where: { id: 'singleton' } });

    return {
      receiptReference: charge.receipt?.receiptNumber || `RCPT-${charge.id.substring(0, 8).toUpperCase()}`,
      receiptId: charge.receipt?.id ?? null,
      transactionId: charge.id,
      issueDate: charge.createdAt,
      // Employee.name is required, so this is always populated; the fallback
      // exists only for defensive symmetry with the rest of this shape.
      patientName: emp.name || 'ESIC Beneficiary',
      employeeId: emp.employeeId || 'N/A',
      employmentType: emp.employmentType?.name || 'Contractual',
      medicineName: charge.description,
      dose: charge.prescriptionItem?.dose ?? '',
      frequency: charge.prescriptionItem?.frequency ?? '',
      duration: charge.prescriptionItem?.duration ?? '',
      outcome: charge.benefitOutcome,
      amountCharged: Number(charge.netAmount),
      currency: 'INR',
      issuingHospital: branding?.hospitalName ?? 'ESIC Model Hospital & ODC',
      status: charge.status === 'PAID' ? 'PAID & ISSUED' : charge.status,
    };
  }
}
