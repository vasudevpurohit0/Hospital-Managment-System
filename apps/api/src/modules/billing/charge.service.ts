import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BenefitOutcome, ChargeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService, PrismaClientLike } from '../catalog/pricing.service';

export interface PostServiceChargeParams {
  visitId: string;
  serviceId: string;
  /** Set for an IPD charge so it counts toward the admission's running total. */
  admissionId?: string;
  /**
   * Set for a lab test charge — the specific ordered item this charge bills.
   * A lab charge is the one case where a clinical link and a priced service
   * co-occur (charge_items_lab_requires_service): the test IS a catalogue
   * service, and the charge also needs to say which order item it was for.
   */
  labOrderItemId?: string;
  /**
   * Set for a per-sitting therapy/procedure charge, posted when the session
   * is marked performed. A course package's one opening charge does not set
   * this — see charge_items_therapy_requires_service and TherapyService.
   */
  therapySessionId?: string;
  quantity?: number;
  /** Defaults to now — pass an explicit date only for backfill/testing. */
  at?: Date;
  actorUserId?: string;
}

/** This system has no discount; every charge stores zero here. */
const ZERO = new Prisma.Decimal(0);

export interface PostPharmacyChargeParams {
  visitId: string;
  prescriptionItemId: string;
  medicineBatchId: string;
  quantity: number;
  unitRate: number | Prisma.Decimal;
  benefitOutcome: BenefitOutcome;
  medicineName: string;
  actorUserId?: string;
}

/**
 * The only writer to ChargeItem.
 *
 * Centralising every charge write here — rather than letting pharmacy, OPD,
 * lab and therapy each insert their own row — is what makes the integrity
 * rules enforceable in one place: the amount arithmetic, and routing every
 * service charge through PricingService so it always cites the price version
 * it used. The database CHECK constraints are the backstop; this service is
 * where the rules are meant to be exercised.
 *
 * BILLING RULE — there is no discount in this system.
 *
 *   netAmount = grossAmount = quantity × the configured service rate
 *
 * `discountAmount` is always zero. It is retained only because the column and
 * its CHECK constraints (`net = gross − discount`) are part of the schema.
 *
 * `benefitOutcome` is recorded for reporting — which entitlement a patient
 * was treated under — but never alters an amount. It previously did: FREE and
 * COVERED charges were written with a full discount to zero and settled
 * immediately as PAID. Because the seeded rule maps PERMANENT employees to
 * COVERED, that silently zeroed essentially every charge in the hospital: a
 * ₹565 therapy posted as gross ₹565, discount ₹565, net ₹0, and the Patient
 * Ledger showed ₹0 for real treatment that had been delivered.
 */
@Injectable()
export class ChargeService {
  private readonly logger = new Logger(ChargeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Posts a charge for a catalogue service (consultation, test, therapy,
   * bed-day, package). Resolves the effective price itself, so a caller can
   * never post a charge at a stale or invented rate.
   *
   * The charge is always quantity × the configured rate, with no discount, and
   * always posts as PENDING until a receipt collects payment — regardless of
   * benefit outcome.
   */
  async postServiceCharge(
    params: PostServiceChargeParams,
    benefitOutcome: BenefitOutcome,
    tx?: PrismaClientLike,
  ): Promise<{ id: string; netAmount: string; status: ChargeStatus }> {
    const client = tx ?? this.prisma;
    const quantity = new Prisma.Decimal(params.quantity ?? 1);

    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Charge quantity must be greater than zero.');
    }

    const visit = await client.visit.findUnique({ where: { id: params.visitId } });
    if (!visit) throw new NotFoundException(`Visit not found: ${params.visitId}`);

    const resolved = await this.pricing.resolve(params.serviceId, params.at, tx);

    // quantity × configured rate, in full. No benefit/coverage adjustment.
    const grossAmount = resolved.amount.mul(quantity);
    const netAmount = grossAmount;

    const created = await client.chargeItem.create({
      data: {
        visitId: params.visitId,
        admissionId: params.admissionId ?? null,
        serviceId: resolved.serviceId,
        servicePriceId: resolved.servicePriceId,
        labOrderItemId: params.labOrderItemId ?? null,
        therapySessionId: params.therapySessionId ?? null,
        description: resolved.serviceName,
        categoryName: resolved.categoryName,
        quantity,
        unitRate: resolved.amount,
        grossAmount,
        discountAmount: ZERO,
        netAmount,
        benefitOutcome,
        status: ChargeStatus.PENDING,
        createdById: params.actorUserId ?? null,
      },
    });

    this.logger.log(
      `Charged ${resolved.serviceName} × ${quantity} = ₹${netAmount.toFixed(2)} ` +
        `(${benefitOutcome}) on visit ${params.visitId}`,
    );

    return { id: created.id, netAmount: netAmount.toString(), status: created.status };
  }

  /**
   * Best-effort service charge: skips posting instead of throwing when the
   * service has no effective price, so a workflow that always wants to try
   * charging (e.g. every OPD visit attempting a consultation fee) does not
   * break while a rate remains unset.
   *
   * Returns null when nothing was charged, and logs why — this is meant for
   * exactly the services the P1 seed left unpriced (CONSULT-*), which will
   * start charging automatically the moment an administrator prices them.
   */
  async postServiceChargeIfPriced(
    params: PostServiceChargeParams,
    benefitOutcome: BenefitOutcome,
    tx?: PrismaClientLike,
  ): Promise<{ id: string; netAmount: string; status: ChargeStatus } | null> {
    try {
      return await this.postServiceCharge(params, benefitOutcome, tx);
    } catch (err) {
      if (err instanceof BadRequestException) {
        this.logger.warn(
          `Skipped charging service ${params.serviceId} on visit ${params.visitId}: ${err.message}`,
        );
        return null;
      }
      throw err;
    }
  }

  /**
   * Posts a pharmacy dispense charge. Unlike a service charge, the rate comes
   * from the dispensed MedicineBatch (already resolved by the caller via
   * FEFO), not from PricingService — medicine pricing intentionally stays on
   * the batch (see plan §07/C5) rather than moving into the service catalogue.
   */
  async postPharmacyCharge(
    params: PostPharmacyChargeParams,
    tx?: PrismaClientLike,
  ): Promise<{ id: string; netAmount: string; status: ChargeStatus }> {
    const client = tx ?? this.prisma;
    const quantity = new Prisma.Decimal(params.quantity);
    const unitRate = new Prisma.Decimal(params.unitRate);

    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Dispense quantity must be greater than zero.');
    }

    const visit = await client.visit.findUnique({ where: { id: params.visitId } });
    if (!visit) throw new NotFoundException(`Visit not found: ${params.visitId}`);

    // Same rule as a service charge: quantity × the batch's issue price, in
    // full, with no benefit/coverage adjustment.
    const grossAmount = unitRate.mul(quantity);
    const netAmount = grossAmount;

    const created = await client.chargeItem.create({
      data: {
        visitId: params.visitId,
        prescriptionItemId: params.prescriptionItemId,
        medicineBatchId: params.medicineBatchId,
        description: params.medicineName,
        categoryName: 'Pharmacy',
        quantity,
        unitRate,
        grossAmount,
        discountAmount: ZERO,
        netAmount,
        benefitOutcome: params.benefitOutcome,
        status: ChargeStatus.PENDING,
        createdById: params.actorUserId ?? null,
      },
    });

    return { id: created.id, netAmount: netAmount.toString(), status: created.status };
  }

  /**
   * Cancels a charge that has not yet been paid — an erroneous order, voided
   * before any money changed hands. A charge already attached to a receipt
   * must be corrected by reversal (a future phase's refund workflow), not by
   * cancellation in place, so this explicitly refuses a PAID charge rather
   * than silently voiding a payment that was actually collected.
   *
   * `actorUserId` is required, not optional: the database itself refuses a
   * CANCELLED row with no recorded actor (charge_items_cancellation_is_complete),
   * so accepting an anonymous cancellation here would only fail later, less
   * clearly, at the database.
   */
  async cancelCharge(chargeId: string, reason: string, actorUserId: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to cancel a charge.');
    }
    if (!actorUserId) {
      throw new BadRequestException('Cancelling a charge requires an identified actor.');
    }

    const charge = await this.prisma.chargeItem.findUnique({ where: { id: chargeId } });
    if (!charge) throw new NotFoundException(`Charge not found: ${chargeId}`);

    if (charge.status === ChargeStatus.CANCELLED) {
      throw new BadRequestException('This charge is already cancelled.');
    }
    if (charge.status === ChargeStatus.PAID) {
      throw new ForbiddenException(
        'A paid charge cannot be cancelled in place. Reversing a paid charge is not yet supported.',
      );
    }

    await this.prisma.chargeItem.update({
      where: { id: chargeId },
      data: {
        status: ChargeStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledById: actorUserId,
        cancelReason: reason.trim(),
      },
    });

    this.logger.log(`Cancelled charge ${chargeId}: ${reason.trim()}`);
  }

  /** All charge lines for one visit, oldest first — the raw material of a receipt or statement. */
  async listByVisit(visitId: string) {
    return this.prisma.chargeItem.findMany({
      where: { visitId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Feature 4 — one patient's complete financial history, across every visit.
   *
   * Three totals, not four: there is no discount in this system, so a
   * "Discount" total would always be zero and is not reported. `totalAmount`
   * is the straight sum of quantity × rate over every live charge; a cancelled
   * charge is excluded entirely, since it owes nothing.
   */
  async patientLedger(identifier: string) {
    const trimmed = identifier.trim();
    // Accepts either identifier, matching Feature 4's own example (a UHID) —
    // both resolve to the same permanent patient, never to a different record.
    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { employeeId: { equals: trimmed, mode: 'insensitive' } },
          { hospitalUid: { uidCode: { equals: trimmed, mode: 'insensitive' } } },
        ],
      },
      include: { hospitalUid: true },
    });
    if (!employee) throw new NotFoundException(`Patient not found for identifier: ${identifier}`);

    const charges = await this.prisma.chargeItem.findMany({
      where: { visit: { employeeId: employee.id }, status: { not: ChargeStatus.CANCELLED } },
      orderBy: { createdAt: 'desc' },
      include: {
        service: { select: { code: true } },
        receipt: { select: { id: true, receiptNumber: true } },
      },
    });

    const sum = (fn: (c: (typeof charges)[number]) => Prisma.Decimal) =>
      charges.reduce((acc, c) => acc.add(fn(c)), new Prisma.Decimal(0));

    const total = sum((c) => c.netAmount);
    const paid = sum((c) => (c.status === ChargeStatus.PAID ? c.netAmount : new Prisma.Decimal(0)));
    const outstanding = sum((c) =>
      c.status === ChargeStatus.PENDING ? c.netAmount : new Prisma.Decimal(0),
    );

    return {
      employeeId: employee.employeeId,
      uhid: employee.hospitalUid?.uidCode ?? null,
      name: employee.name,
      summary: {
        totalAmount: total.toString(),
        paidAmount: paid.toString(),
        outstandingAmount: outstanding.toString(),
      },
      transactions: charges.map((c) => ({
        id: c.id,
        date: c.createdAt,
        service: c.description,
        serviceCode: c.service?.code ?? null,
        category: c.categoryName,
        quantity: c.quantity.toString(),
        rate: c.unitRate.toString(),
        // quantity × rate, in full — the only amount the ledger reports.
        totalAmount: c.netAmount.toString(),
        status: c.status,
        receiptNumber: c.receipt?.receiptNumber ?? null,
        receiptId: c.receipt?.id ?? null,
      })),
    };
  }

  /** Total patient expenses across all patients, strictly within the provided date range. */
  async getSummary(from?: Date, to?: Date) {
    const createdAt =
      from || to
        ? {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          }
        : undefined;

    const aggregate = await this.prisma.chargeItem.aggregate({
      where: {
        status: { not: ChargeStatus.CANCELLED },
        ...(createdAt ? { createdAt } : {}),
      },
      _sum: { netAmount: true },
    });

    return {
      totalAmount: (aggregate._sum.netAmount ?? 0).toString(),
    };
  }

  /** Detailed patient expenses breakdown for ALL patients within the given date range. */
  async getDetailedPatientExpenses(from?: Date, to?: Date, periodLabel?: string) {
    const createdAt =
      from || to
        ? {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          }
        : undefined;

    const charges = await this.prisma.chargeItem.findMany({
      where: {
        status: { not: ChargeStatus.CANCELLED },
        ...(createdAt ? { createdAt } : {}),
      },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        visit: {
          include: {
            employee: {
              include: {
                hospitalUid: true,
              },
            },
          },
        },
      },
    });

    const patientMap = new Map<
      string,
      {
        patient: {
          id: string;
          name: string;
          employeeId: string;
          uhid: string;
          department: string;
        };
        totalExpense: Prisma.Decimal;
        transactions: Array<{
          date: Date;
          service: string;
          category: string;
          quantity: Prisma.Decimal;
          rate: Prisma.Decimal;
          total: Prisma.Decimal;
          status: ChargeStatus;
        }>;
      }
    >();

    for (const c of charges) {
      const emp = c.visit.employee;
      const key = emp.id;
      let p = patientMap.get(key);
      if (!p) {
        p = {
          patient: {
            id: emp.id,
            name: emp.name,
            employeeId: emp.employeeId,
            uhid: emp.hospitalUid?.uidCode ?? '—',
            department: emp.department,
          },
          totalExpense: new Prisma.Decimal(0),
          transactions: [],
        };
        patientMap.set(key, p);
      }

      p.totalExpense = p.totalExpense.add(c.netAmount);
      p.transactions.push({
        date: c.createdAt,
        service: c.description,
        category: c.categoryName,
        quantity: c.quantity,
        rate: c.unitRate,
        total: c.netAmount,
        status: c.status,
      });
    }

    const patients = Array.from(patientMap.values()).sort((a, b) =>
      a.patient.name.localeCompare(b.patient.name),
    );

    const grandTotal = patients.reduce(
      (sum, p) => sum.add(p.totalExpense),
      new Prisma.Decimal(0),
    );

    return {
      periodLabel: periodLabel || 'Selected Period',
      from,
      to,
      generatedAt: new Date(),
      grandTotal,
      totalPatients: patients.length,
      totalTransactions: charges.length,
      patients,
    };
  }
}

