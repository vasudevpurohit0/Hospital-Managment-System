import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdmissionStatus, ChargeStatus, FacilityCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChargeService } from '../billing/charge.service';
import { PrismaClientLike } from '../catalog/pricing.service';
import { BenefitRuleService } from '../benefit/benefit-rule.service';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { runWithTenant } from '../../common/tenant/tenant-context';

/** Ward category → the bed-day Service billed for it (plan §11). */
const BED_SERVICE_BY_CATEGORY: Record<FacilityCategory, string> = {
  A: 'BED-PRIVATE',
  B: 'BED-SEMIPRIVATE',
  C: 'BED-GENERAL',
  D: 'BED-GENERAL',
  CONTRACTUAL: 'BED-GENERAL',
};

export interface TransferBedParams {
  admissionId: string;
  toBedId: string;
  reason: string;
  movedById: string;
}

/**
 * IPD financial tracking (Feature 8) and patient location (Feature 9).
 *
 * Bed-day charges are written in two places, both funnelled through
 * `postBedDayForAdmission` so they share one rule: idempotent per (admission,
 * calendar day), so re-running — a cron misfire, an operator re-run, or the
 * allocation-day charge meeting the nightly job — can never double-charge a
 * day.
 *
 *  - Bed allocation posts the FIRST day immediately (see
 *    AdmissionService.allocateBed). Without this, a patient admitted and
 *    discharged before the first midnight — a same-day stay — was billed
 *    nothing at all, and their Patient Ledger showed ₹0 after a real IPD
 *    episode.
 *  - The nightly job posts one charge per subsequent day the patient is still
 *    UNDER_TREATMENT.
 *
 * Discharge itself posts nothing and deletes nothing: the append-only ledger
 * already has everything a final bill needs (Feature 8 — "do not lose charges
 * when the admission is closed").
 */
@Injectable()
export class IpdFinanceService {
  private readonly logger = new Logger(IpdFinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: ChargeService,
    private readonly benefitRules: BenefitRuleService,
    private readonly platformPrisma: PlatformPrismaService,
    private readonly tenantClients: TenantClientFactory,
  ) {}

  /**
   * Runs outside any HTTP request, so there is no AsyncLocalStorage tenant
   * context to inherit -- it must set one explicitly per hospital. Fans out
   * across every ACTIVE hospital so a missed night for one tenant doesn't
   * block the rest.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runNightlyBedDayJob(): Promise<void> {
    const hospitals = await this.platformPrisma.hospital.findMany({
      where: { status: 'ACTIVE' },
    });
    const forDate = new Date();
    for (const hospital of hospitals) {
      try {
        const client = await this.tenantClients.getClient(hospital.schemaName);
        await runWithTenant(
          { hospitalId: hospital.id, schemaName: hospital.schemaName, prismaClient: client },
          () => this.postBedDayCharges(forDate),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Nightly bed-day job failed for hospital "${hospital.slug}": ${message}`);
      }
    }
  }

  /**
   * Posts one bed-day charge for every currently-occupied bed, for the given
   * calendar day. Exposed (not just cron-triggered) so an administrator can
   * re-run it for a specific date if the cron missed a night.
   */
  async postBedDayCharges(forDate: Date): Promise<{ posted: number; skipped: number }> {
    const admissions = await this.prisma.admission.findMany({
      where: {
        status: AdmissionStatus.UNDER_TREATMENT,
        bedId: { not: null },
      },
      select: { id: true },
    });

    let posted = 0;
    let skipped = 0;

    for (const { id } of admissions) {
      const result = await this.postBedDayForAdmission(id, forDate);
      if (result === 'posted') posted++;
      else skipped++;
    }

    const day = new Date(forDate);
    day.setHours(0, 0, 0, 0);
    this.logger.log(`Bed-day job for ${day.toDateString()}: ${posted} posted, ${skipped} skipped`);
    return { posted, skipped };
  }

  /**
   * Posts the bed-day charge for ONE admission on ONE calendar day, unless a
   * charge for that (admission, day) already exists. Shared by the nightly job
   * and by bed allocation — see the class doc for why allocation needs it.
   *
   * Accepts an optional transaction client so the allocation flow can post the
   * first day's charge inside the same transaction that marks the admission
   * UNDER_TREATMENT: either both land or neither does.
   */
  async postBedDayForAdmission(
    admissionId: string,
    forDate: Date = new Date(),
    tx?: PrismaClientLike,
  ): Promise<'posted' | 'skipped'> {
    const client = tx ?? this.prisma;

    const dayStart = new Date(forDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const admission = await client.admission.findUnique({
      where: { id: admissionId },
      include: {
        ward: true,
        visit: { include: { employee: { include: { employmentType: true } } } },
      },
    });
    if (!admission || !admission.ward || !admission.bedId) {
      this.logger.warn(`Bed-day charge skipped — admission ${admissionId} has no ward/bed.`);
      return 'skipped';
    }

    const serviceCode = BED_SERVICE_BY_CATEGORY[admission.ward.category];
    const service = await client.service.findUnique({ where: { code: serviceCode } });
    if (!service) {
      this.logger.warn(`Bed-day service ${serviceCode} not found — skipping admission ${admission.id}`);
      return 'skipped';
    }

    // Idempotency: a bed-day charge for this admission/service already dated
    // this calendar day means the nightly job, an operator re-run, or the
    // allocation-day post already covered it — skip rather than double-charge.
    const already = await client.chargeItem.findFirst({
      where: {
        admissionId: admission.id,
        serviceId: service.id,
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    if (already) return 'skipped';

    try {
      const outcome = await this.benefitRules.evaluate(admission.visit.employee.employmentType.code);
      const charge = await this.charges.postServiceChargeIfPriced(
        { visitId: admission.visitId, admissionId: admission.id, serviceId: service.id, at: forDate },
        outcome,
        tx,
      );
      // postServiceChargeIfPriced returns null — without throwing — when the
      // service has no effective price. That must count as skipped, not
      // posted: a previous version of this job counted the silent skip as
      // `posted` and reported bed-day charges succeeding for months while
      // writing zero rows.
      if (charge) return 'posted';
      this.logger.warn(
        `Bed-day service ${serviceCode} has no effective price — no charge posted for admission ${admission.id}.`,
      );
      return 'skipped';
    } catch (err) {
      this.logger.error(`Failed to post bed-day charge for admission ${admission.id}: ${err}`);
      return 'skipped';
    }
  }

  /**
   * Transfers an admission to a new bed, recording the move in the
   * append-only location trail. Frees the old bed and occupies the new one
   * in the same transaction as the history row, so the two can never
   * disagree about where the patient currently is.
   */
  async transferBed(params: TransferBedParams) {
    if (!params.reason?.trim()) {
      throw new BadRequestException('A reason is required to transfer a patient.');
    }

    const admission = await this.prisma.admission.findUnique({ where: { id: params.admissionId } });
    if (!admission) throw new NotFoundException(`Admission not found: ${params.admissionId}`);

    const newBed = await this.prisma.bed.findUnique({
      where: { id: params.toBedId },
      include: { room: true },
    });
    if (!newBed) throw new NotFoundException(`Bed not found: ${params.toBedId}`);
    if (newBed.currentAdmissionId && newBed.currentAdmissionId !== admission.id) {
      throw new BadRequestException(`Bed ${newBed.bedNumber} is already occupied.`);
    }
    if (newBed.id === admission.bedId) {
      throw new BadRequestException('This admission is already in that bed.');
    }

    return this.prisma.$transaction(async (tx) => {
      if (admission.bedId) {
        await tx.bed.update({
          where: { id: admission.bedId },
          data: { status: 'AVAILABLE', currentAdmissionId: null },
        });
      }

      await tx.bed.update({
        where: { id: newBed.id },
        data: { status: 'OCCUPIED', currentAdmissionId: admission.id },
      });

      const updatedAdmission = await tx.admission.update({
        where: { id: admission.id },
        data: { bedId: newBed.id, roomId: newBed.roomId, wardId: newBed.room.wardId },
        include: { ward: true, room: true, bed: true },
      });

      await tx.patientLocationHistory.create({
        data: {
          admissionId: admission.id,
          fromWardId: admission.wardId,
          fromRoomId: admission.roomId,
          fromBedId: admission.bedId,
          toWardId: newBed.room.wardId,
          toRoomId: newBed.roomId,
          toBedId: newBed.id,
          movedById: params.movedById,
          reason: params.reason.trim(),
        },
      });

      this.logger.log(
        `Transferred admission ${admission.id}: ${admission.bedId ?? 'unassigned'} → ${newBed.id}`,
      );

      return updatedAdmission;
    });
  }

  async getLocationHistory(admissionId: string) {
    return this.prisma.patientLocationHistory.findMany({
      where: { admissionId },
      include: {
        fromWard: true,
        fromRoom: true,
        fromBed: true,
        toWard: true,
        toRoom: true,
        toBed: true,
        movedBy: { select: { identifier: true } },
      },
      orderBy: { movedAt: 'desc' },
    });
  }

  /**
   * Feature 8's "Admission → All Charges → Final Bill" — the four totals
   * scoped to ONE admission, not a patient's whole lifetime the way the
   * Patient Ledger (ChargeService.patientLedger) is.
   */
  async admissionFinancialSummary(admissionId: string) {
    const admission = await this.prisma.admission.findUnique({
      where: { id: admissionId },
      include: { visit: { include: { employee: { include: { hospitalUid: true } } } } },
    });
    if (!admission) throw new NotFoundException(`Admission not found: ${admissionId}`);

    const charges = await this.prisma.chargeItem.findMany({
      where: { admissionId, status: { not: ChargeStatus.CANCELLED } },
      orderBy: { createdAt: 'asc' },
    });

    const sum = (fn: (c: (typeof charges)[number]) => Prisma.Decimal) =>
      charges.reduce((acc, c) => acc.add(fn(c)), new Prisma.Decimal(0));

    return {
      admissionId,
      uhid: admission.visit.employee.hospitalUid?.uidCode ?? null,
      employeeId: admission.visit.employee.employeeId,
      status: admission.status,
      admittedAt: admission.allocatedAt,
      dischargedAt: admission.dischargedAt,
      summary: {
        // No discount in this system — each line is quantity × its rate.
        totalAmount: sum((c) => c.netAmount).toString(),
        paidAmount: sum((c) =>
          c.status === ChargeStatus.PAID ? c.netAmount : new Prisma.Decimal(0),
        ).toString(),
        outstandingAmount: sum((c) =>
          c.status === ChargeStatus.PENDING ? c.netAmount : new Prisma.Decimal(0),
        ).toString(),
      },
      lineItems: charges.map((c) => ({
        date: c.createdAt,
        description: c.description,
        category: c.categoryName,
        quantity: c.quantity.toString(),
        rate: c.unitRate.toString(),
        totalAmount: c.netAmount.toString(),
        status: c.status,
      })),
    };
  }
}
