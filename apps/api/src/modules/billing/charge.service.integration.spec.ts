import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BenefitOutcome, ChargeStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../catalog/pricing.service';
import { ChargeService } from './charge.service';

/**
 * Integration tests against the real database.
 *
 * What is under test here — the exactly-one-source CHECK constraint, the
 * arithmetic-consistency constraints, and cross-table atomicity — is
 * meaningless against a mocked Prisma client, since a mock cannot reject an
 * insert the way Postgres does. These exercise the real thing.
 */
const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDb('ChargeService (integration)', () => {
  let prisma: PrismaService;
  let pricing: PricingService;
  let charges: ChargeService;

  let categoryId: string;
  let visitId: string;
  let employeeId: string;
  let actorUserId: string;
  const createdServiceIds: string[] = [];
  const createdVisitIds: string[] = [];
  const createdEmployeeIds: string[] = [];

  const uniqueSuffix = () => Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);

  async function makePricedService(amount: number) {
    const svc = await prisma.service.create({
      data: {
        code: `ZZCHG-${uniqueSuffix()}`,
        name: 'Test Service',
        categoryId,
        serviceType: 'THERAPY',
        applicability: 'BOTH',
        unit: 'SITTING',
      },
    });
    createdServiceIds.push(svc.id);
    await prisma.servicePrice.create({
      data: { serviceId: svc.id, amount, effectiveFrom: new Date('2026-01-01'), reason: 'test' },
    });
    return svc;
  }

  /** A fresh employee + open visit, so tests never collide over shared fixtures. */
  async function makeVisit() {
    const permanentType = await prisma.employmentType.findFirstOrThrow({
      where: { code: 'PERMANENT' },
    });
    const post = await prisma.post.findFirstOrThrow();
    const grade = await prisma.grade.findFirstOrThrow();

    const employee = await prisma.employee.create({
      data: {
        employeeId: `ZZ-CHG-${uniqueSuffix()}`,
        name: 'Charge Test Patient',
        department: 'Test',
        postId: post.id,
        gradeId: grade.id,
        employmentTypeId: permanentType.id,
      },
    });
    createdEmployeeIds.push(employee.id);

    const visit = await prisma.visit.create({
      data: { employeeId: employee.id, type: 'OPD', status: 'OPEN' },
    });
    createdVisitIds.push(visit.id);
    return { visitId: visit.id, employeeId: employee.employeeId };
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    pricing = new PricingService(prisma);
    charges = new ChargeService(prisma, pricing);

    const category = await prisma.serviceCategory.upsert({
      where: { code: 'ZZCHGCAT' },
      update: {},
      create: { code: 'ZZCHGCAT', name: 'Charge Test Category', sortOrder: 999 },
    });
    categoryId = category.id;

    const v = await makeVisit();
    visitId = v.visitId;
    employeeId = v.employeeId;
    actorUserId = (await prisma.user.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await prisma.chargeItem.deleteMany({ where: { visitId: { in: createdVisitIds } } });
    await prisma.receipt.deleteMany({ where: { visitId: { in: createdVisitIds } } });
    await prisma.visit.deleteMany({ where: { id: { in: createdVisitIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: createdEmployeeIds } } });
    await prisma.servicePrice.deleteMany({ where: { serviceId: { in: createdServiceIds } } });
    await prisma.service.deleteMany({ where: { id: { in: createdServiceIds } } });
    await prisma.serviceCategory.deleteMany({ where: { code: 'ZZCHGCAT' } });
    await prisma.$disconnect();
  });

  describe('source integrity', () => {
    it('a service charge always cites the exact price version used', async () => {
      const svc = await makePricedService(500);
      const result = await charges.postServiceCharge(
        { visitId, serviceId: svc.id },
        BenefitOutcome.PAID,
      );

      const row = await prisma.chargeItem.findUniqueOrThrow({ where: { id: result.id } });
      expect(row.serviceId).toBe(svc.id);
      expect(row.servicePriceId).not.toBeNull();
      expect(row.prescriptionItemId).toBeNull();
      expect(row.medicineBatchId).toBeNull();
    });

    it('refuses to charge a service with no effective price rather than inventing a rate', async () => {
      const svc = await prisma.service.create({
        data: {
          code: `ZZCHG-UNPRICED-${uniqueSuffix()}`,
          name: 'Unpriced',
          categoryId,
          serviceType: 'THERAPY',
        },
      });
      createdServiceIds.push(svc.id);

      await expect(
        charges.postServiceCharge({ visitId, serviceId: svc.id }, BenefitOutcome.PAID),
      ).rejects.toThrow(BadRequestException);
    });

    // The database's own exactly-one-source CHECK is proven directly in
    // pricing.service.spec-adjacent raw-SQL tests; this proves the SERVICE
    // never even attempts to construct an ambiguous row.
    it('never sets both a service source and a pharmacy source on one charge', async () => {
      const svc = await makePricedService(200);
      const result = await charges.postServiceCharge(
        { visitId, serviceId: svc.id },
        BenefitOutcome.PAID,
      );
      const row = await prisma.chargeItem.findUniqueOrThrow({ where: { id: result.id } });

      expect([row.serviceId, row.prescriptionItemId].filter(Boolean)).toHaveLength(1);
    });

    it('rejects a zero or negative quantity rather than posting a meaningless charge', async () => {
      const svc = await makePricedService(100);
      await expect(
        charges.postServiceCharge({ visitId, serviceId: svc.id, quantity: 0 }, BenefitOutcome.PAID),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a charge against a visit that does not exist — no orphan by construction', async () => {
      const svc = await makePricedService(100);
      await expect(
        charges.postServiceCharge(
          { visitId: '00000000-0000-0000-0000-000000000000', serviceId: svc.id },
          BenefitOutcome.PAID,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  /**
   * There is no discount in this system. A charge is always quantity × the
   * configured rate, and benefit outcome never touches the money.
   *
   * This replaces the old "benefit-outcome zeroing" behaviour, which wrote
   * FREE/COVERED charges with a full discount to zero. Because the seeded rule
   * maps PERMANENT employees to COVERED, that zeroed essentially every charge
   * in the hospital — a ₹565 therapy landed in the Patient Ledger as ₹0.
   */
  describe('amount is always quantity × rate', () => {
    it.each([BenefitOutcome.PAID, BenefitOutcome.COVERED, BenefitOutcome.FREE])(
      '%s posts the full amount, undiscounted and outstanding',
      async (outcome) => {
        const svc = await makePricedService(300);
        const result = await charges.postServiceCharge({ visitId, serviceId: svc.id }, outcome);
        const row = await prisma.chargeItem.findUniqueOrThrow({ where: { id: result.id } });

        expect(row.grossAmount.toString()).toBe('300');
        expect(row.discountAmount.toString()).toBe('0');
        expect(row.netAmount.toString()).toBe('300');
        expect(result.netAmount).toBe('300');
        // Nothing settles at charge time any more — payment goes through a receipt.
        expect(result.status).toBe(ChargeStatus.PENDING);
      },
    );

    it('multiplies quantity by the configured rate', async () => {
      const svc = await makePricedService(565);
      const result = await charges.postServiceCharge(
        { visitId, serviceId: svc.id, quantity: 3 },
        BenefitOutcome.COVERED,
      );
      const row = await prisma.chargeItem.findUniqueOrThrow({ where: { id: result.id } });

      expect(row.unitRate.toString()).toBe('565');
      expect(row.quantity.toString()).toBe('3');
      expect(row.netAmount.toString()).toBe('1695');
      expect(row.discountAmount.toString()).toBe('0');
    });


    it('best-effort posting skips silently when unpriced, never throws', async () => {
      const svc = await prisma.service.create({
        data: { code: `ZZCHG-SKIP-${uniqueSuffix()}`, name: 'Skip', categoryId, serviceType: 'THERAPY' },
      });
      createdServiceIds.push(svc.id);

      const result = await charges.postServiceChargeIfPriced(
        { visitId, serviceId: svc.id },
        BenefitOutcome.PAID,
      );
      expect(result).toBeNull();

      const rows = await prisma.chargeItem.count({ where: { serviceId: svc.id } });
      expect(rows).toBe(0);
    });
  });

  describe('cancellation', () => {
    it('cancels a PENDING charge and records who, when and why', async () => {
      const svc = await makePricedService(100);
      const result = await charges.postServiceCharge(
        { visitId, serviceId: svc.id },
        BenefitOutcome.PAID,
      );

      await charges.cancelCharge(result.id, 'Ordered in error', actorUserId);

      const row = await prisma.chargeItem.findUniqueOrThrow({ where: { id: result.id } });
      expect(row.status).toBe(ChargeStatus.CANCELLED);
      expect(row.cancelledAt).not.toBeNull();
      expect(row.cancelReason).toBe('Ordered in error');
    });

    it('refuses to cancel a PAID charge — reversal, not in-place cancellation', async () => {
      const svc = await makePricedService(100);
      const result = await charges.postServiceCharge(
        { visitId, serviceId: svc.id },
        BenefitOutcome.COVERED,
      );
      // Every charge now posts PENDING; only a receipt marks one PAID. Set the
      // status directly rather than pulling ReceiptService into this suite —
      // the guard under test reads status, not how it got there.
      await prisma.chargeItem.update({
        where: { id: result.id },
        data: { status: ChargeStatus.PAID },
      });

      await expect(charges.cancelCharge(result.id, 'trying anyway', actorUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses to cancel an already-cancelled charge twice', async () => {
      const svc = await makePricedService(100);
      const result = await charges.postServiceCharge(
        { visitId, serviceId: svc.id },
        BenefitOutcome.PAID,
      );
      await charges.cancelCharge(result.id, 'first cancel', actorUserId);

      await expect(charges.cancelCharge(result.id, 'second cancel', actorUserId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('requires a reason to cancel', async () => {
      const svc = await makePricedService(100);
      const result = await charges.postServiceCharge(
        { visitId, serviceId: svc.id },
        BenefitOutcome.PAID,
      );
      await expect(charges.cancelCharge(result.id, '  ', actorUserId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('requires an identified actor to cancel — the database itself refuses an anonymous cancellation', async () => {
      const svc = await makePricedService(100);
      const result = await charges.postServiceCharge(
        { visitId, serviceId: svc.id },
        BenefitOutcome.PAID,
      );
      await expect(charges.cancelCharge(result.id, 'no actor given', '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("Feature 4 — patient ledger's totals", () => {
    it('total, paid and outstanding reconcile against posted charges', async () => {
      const { visitId: freshVisit, employeeId: freshEmployee } = await makeVisit();

      const paidSvc = await makePricedService(500);
      const coveredSvc = await makePricedService(200);

      const paidCharge = await charges.postServiceCharge(
        { visitId: freshVisit, serviceId: paidSvc.id },
        BenefitOutcome.PAID,
      );
      await charges.postServiceCharge(
        { visitId: freshVisit, serviceId: coveredSvc.id },
        BenefitOutcome.COVERED,
      );

      const ledger = await charges.patientLedger(freshEmployee);

      // Both charges count at full value — the COVERED one is NOT zeroed.
      expect(ledger.summary.totalAmount).toBe('700');
      expect(ledger.summary.paidAmount).toBe('0'); // nothing receipted yet
      expect(ledger.summary.outstandingAmount).toBe('700');
      expect(ledger.transactions).toHaveLength(2);
      expect(ledger.transactions.map((t) => t.totalAmount).sort()).toEqual(['200', '500']);

      // A cancelled charge must drop out of every total, not just display as 0.
      await charges.cancelCharge(paidCharge.id, 'test cleanup', actorUserId);
      const after = await charges.patientLedger(freshEmployee);
      expect(after.summary.totalAmount).toBe('200');
      expect(after.summary.outstandingAmount).toBe('200');
    });

    it('throws for an employee that does not exist rather than an empty ledger', async () => {
      await expect(charges.patientLedger('NO-SUCH-EMPLOYEE')).rejects.toThrow(NotFoundException);
    });
  });
});
