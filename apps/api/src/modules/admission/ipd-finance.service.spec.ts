import { BadRequestException } from '@nestjs/common';
import { AdmissionStatus, BedStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../catalog/pricing.service';
import { ChargeService } from '../billing/charge.service';
import { BenefitRuleService } from '../benefit/benefit-rule.service';
import { IpdFinanceService } from './ipd-finance.service';

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDb('IpdFinanceService (integration)', () => {
  let prisma: PrismaService;
  let ipd: IpdFinanceService;
  let actorUserId: string;

  const createdEmployeeIds: string[] = [];
  const createdVisitIds: string[] = [];
  const createdAdmissionIds: string[] = [];
  const createdBedIds: string[] = [];
  let generalBedServiceId: string;
  let seededPrice = false;

  const uniqueSuffix = () => Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);

  /** A fresh CONTRACTUAL (→ PAID) employee, open visit, and UNDER_TREATMENT admission in an existing General Ward bed. */
  async function makeAdmission() {
    const contractualType = await prisma.employmentType.findFirstOrThrow({ where: { code: 'CONTRACTUAL' } });
    const post = await prisma.post.findFirstOrThrow();
    const grade = await prisma.grade.findFirstOrThrow();
    const employee = await prisma.employee.create({
      data: {
        employeeId: `ZZ-IPD-${uniqueSuffix()}`,
        name: 'IPD Test Patient',
        department: 'Test',
        postId: post.id,
        gradeId: grade.id,
        employmentTypeId: contractualType.id,
      },
    });
    createdEmployeeIds.push(employee.id);

    const visit = await prisma.visit.create({ data: { employeeId: employee.id, type: 'IPD', status: 'OPEN' } });
    createdVisitIds.push(visit.id);

    const ward = await prisma.ward.findFirstOrThrow({ where: { category: 'C' } });
    const room = await prisma.room.findFirstOrThrow({ where: { wardId: ward.id } });
    const bed = await prisma.bed.create({
      data: { roomId: room.id, bedNumber: `ZZ-${uniqueSuffix()}`, status: BedStatus.OCCUPIED },
    });
    createdBedIds.push(bed.id);

    const admission = await prisma.admission.create({
      data: {
        visitId: visit.id,
        status: AdmissionStatus.UNDER_TREATMENT,
        wardId: ward.id,
        roomId: room.id,
        bedId: bed.id,
        allocatedAt: new Date(),
      },
    });
    createdAdmissionIds.push(admission.id);
    await prisma.bed.update({ where: { id: bed.id }, data: { currentAdmissionId: admission.id } });

    return { admissionId: admission.id, bedId: bed.id, wardId: ward.id, roomId: room.id };
  }

  /**
   * Runs the real job, then immediately deletes any charge it posted against
   * an admission this suite did not create. The job intentionally scans every
   * UNDER_TREATMENT admission in the database, and this suite temporarily
   * prices BED-GENERAL to exercise it — so a genuine pre-existing admission in
   * a General/D/Contractual ward would otherwise receive a real, if harmless,
   * stray charge. This runs after every call, not just at suite teardown, so
   * a test failure partway through can never leave that collateral behind.
   */
  async function runJobIsolated(forDate: Date) {
    const result = await ipd.postBedDayCharges(forDate);
    await prisma.chargeItem.deleteMany({
      where: { serviceId: generalBedServiceId, admissionId: { notIn: createdAdmissionIds } },
    });
    return result;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const pricing = new PricingService(prisma);
    const charges = new ChargeService(prisma, pricing);
    const benefitRules = new BenefitRuleService(prisma);
    ipd = new IpdFinanceService(prisma, charges, benefitRules);

    actorUserId = (await prisma.user.findFirstOrThrow({ where: { role: { name: 'AdmissionDesk' } } })).id;

    // BED-GENERAL is seeded unpriced (plan §11 decision #1); price it for
    // this suite only, and remove the price afterward so this test does not
    // silently leave a rate an administrator never actually approved.
    const bedService = await prisma.service.findUniqueOrThrow({ where: { code: 'BED-GENERAL' } });
    generalBedServiceId = bedService.id;
    const existingPrice = await prisma.servicePrice.findFirst({
      where: { serviceId: generalBedServiceId, effectiveTo: null },
    });
    if (!existingPrice) {
      await prisma.servicePrice.create({
        data: {
          serviceId: generalBedServiceId,
          amount: 500,
          effectiveFrom: new Date('2026-01-01'),
          reason: 'Test-only price for IpdFinanceService suite',
        },
      });
      seededPrice = true;
    }
  });

  afterAll(async () => {
    await prisma.patientLocationHistory.deleteMany({ where: { admissionId: { in: createdAdmissionIds } } });
    await prisma.chargeItem.deleteMany({ where: { admissionId: { in: createdAdmissionIds } } });
    await prisma.admission.deleteMany({ where: { id: { in: createdAdmissionIds } } });
    await prisma.bed.deleteMany({ where: { id: { in: createdBedIds } } });
    await prisma.visit.deleteMany({ where: { id: { in: createdVisitIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: createdEmployeeIds } } });

    if (seededPrice) {
      await prisma.servicePrice.deleteMany({ where: { serviceId: generalBedServiceId } });
    }

    await prisma.$disconnect();
  });

  describe('nightly bed-day job — Feature 8', () => {
    it('posts one bed-day charge for an occupied bed', async () => {
      const { admissionId } = await makeAdmission();
      const result = await runJobIsolated(new Date());
      expect(result.posted).toBeGreaterThanOrEqual(1);

      const charge = await prisma.chargeItem.findFirst({
        where: { admissionId, serviceId: generalBedServiceId },
      });
      expect(charge).not.toBeNull();
      expect(Number(charge!.netAmount)).toBe(500);
    });

    it('is idempotent: running it twice for the same day posts only one charge', async () => {
      const { admissionId } = await makeAdmission();
      await runJobIsolated(new Date());
      await runJobIsolated(new Date());

      const count = await prisma.chargeItem.count({ where: { admissionId, serviceId: generalBedServiceId } });
      expect(count).toBe(1);
    });

    it('never charges an admission that is not UNDER_TREATMENT', async () => {
      const { admissionId } = await makeAdmission();
      await prisma.admission.update({ where: { id: admissionId }, data: { status: AdmissionStatus.DISCHARGED } });

      await runJobIsolated(new Date());
      const count = await prisma.chargeItem.count({ where: { admissionId } });
      expect(count).toBe(0);
    });

    /**
     * Regression test for a real bug found in production data: every
     * BED_DAY service ships unpriced (no source rate to invent), so
     * postServiceChargeIfPriced correctly declines to charge — but the job
     * counted that decline as `posted` anyway, since it never inspected the
     * (possibly-null) return value. The job reported bed-day charges
     * succeeding for every admission in the system while posting zero rows,
     * and the one number meant to reveal that (`posted`) was the one lying
     * about it.
     */
    it('reports skipped, not posted, and posts zero charges when the bed-day service has no price', async () => {
      const { admissionId } = await makeAdmission();

      // Close the price this suite's beforeAll opened, for this one call only.
      const openPrice = await prisma.servicePrice.findFirst({
        where: { serviceId: generalBedServiceId, effectiveTo: null },
      });
      expect(openPrice).not.toBeNull();
      await prisma.servicePrice.update({ where: { id: openPrice!.id }, data: { effectiveTo: new Date() } });

      try {
        const result = await runJobIsolated(new Date());
        expect(result.skipped).toBeGreaterThanOrEqual(1);

        const count = await prisma.chargeItem.count({ where: { admissionId, serviceId: generalBedServiceId } });
        expect(count).toBe(0);
      } finally {
        // Reopen the suite's price so every later test keeps seeing a priced BED-GENERAL.
        await prisma.servicePrice.update({ where: { id: openPrice!.id }, data: { effectiveTo: null } });
      }
    });
  });

  describe('postBedDayForAdmission — same-day stay', () => {
    it('bills the admission day even when the nightly job never runs for it', async () => {
      const { admissionId } = await makeAdmission();

      // Simulates what AdmissionService.allocateBed now does: post today's
      // bed-day directly, without waiting for midnight.
      const first = await ipd.postBedDayForAdmission(admissionId, new Date());
      expect(first).toBe('posted');

      const count = await prisma.chargeItem.count({
        where: { admissionId, serviceId: generalBedServiceId },
      });
      expect(count).toBe(1);
    });

    it('is idempotent against the nightly job covering the same day', async () => {
      const { admissionId } = await makeAdmission();

      await ipd.postBedDayForAdmission(admissionId, new Date());
      const second = await ipd.postBedDayForAdmission(admissionId, new Date());
      expect(second).toBe('skipped');
      await runJobIsolated(new Date()); // nightly job, same calendar day

      const count = await prisma.chargeItem.count({
        where: { admissionId, serviceId: generalBedServiceId },
      });
      expect(count).toBe(1);
    });
  });

  describe('bed transfer — Feature 9', () => {
    it('moves the admission, frees the old bed, occupies the new one, and records history', async () => {
      const { admissionId, bedId: oldBedId, wardId, roomId } = await makeAdmission();
      const newBed = await prisma.bed.create({
        data: { roomId, bedNumber: `ZZ-NEW-${uniqueSuffix()}`, status: BedStatus.AVAILABLE },
      });
      createdBedIds.push(newBed.id);

      await ipd.transferBed({
        admissionId,
        toBedId: newBed.id,
        reason: 'Ward reorganisation',
        movedById: actorUserId,
      });

      const oldBed = await prisma.bed.findUniqueOrThrow({ where: { id: oldBedId } });
      expect(oldBed.status).toBe(BedStatus.AVAILABLE);
      expect(oldBed.currentAdmissionId).toBeNull();

      const movedToBed = await prisma.bed.findUniqueOrThrow({ where: { id: newBed.id } });
      expect(movedToBed.status).toBe(BedStatus.OCCUPIED);
      expect(movedToBed.currentAdmissionId).toBe(admissionId);

      const admission = await prisma.admission.findUniqueOrThrow({ where: { id: admissionId } });
      expect(admission.bedId).toBe(newBed.id);
      expect(admission.wardId).toBe(wardId);

      const history = await ipd.getLocationHistory(admissionId);
      expect(history).toHaveLength(1);
      expect(history[0].fromBedId).toBe(oldBedId);
      expect(history[0].toBedId).toBe(newBed.id);
      expect(history[0].reason).toBe('Ward reorganisation');
    });

    it('refuses to transfer into an already-occupied bed', async () => {
      const { admissionId, roomId } = await makeAdmission();
      const { admissionId: otherAdmissionId, bedId: occupiedBedId } = await makeAdmission();

      await expect(
        ipd.transferBed({ admissionId, toBedId: occupiedBedId, reason: 'test', movedById: actorUserId }),
      ).rejects.toThrow(BadRequestException);

      expect(otherAdmissionId).toBeTruthy(); // keep the fixture referenced
      expect(roomId).toBeTruthy();
    });

    it('requires a reason', async () => {
      const { admissionId, roomId } = await makeAdmission();
      const newBed = await prisma.bed.create({
        data: { roomId, bedNumber: `ZZ-R-${uniqueSuffix()}`, status: BedStatus.AVAILABLE },
      });
      createdBedIds.push(newBed.id);

      await expect(
        ipd.transferBed({ admissionId, toBedId: newBed.id, reason: '  ', movedById: actorUserId }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('admission financial summary', () => {
    it('reconciles total/paid/outstanding against posted charges', async () => {
      const { admissionId } = await makeAdmission();
      await runJobIsolated(new Date());

      const summary = await ipd.admissionFinancialSummary(admissionId);
      expect(summary.summary.totalAmount).toBe('500');
      expect(summary.summary.outstandingAmount).toBe('500');
      expect(summary.lineItems).toHaveLength(1);
    });

    // Feature 8: charges must survive discharge, not be closed out or deleted.
    it('keeps every charge after discharge — nothing is lost or altered', async () => {
      const { admissionId } = await makeAdmission();
      await runJobIsolated(new Date());

      await prisma.admission.update({
        where: { id: admissionId },
        data: { status: AdmissionStatus.DISCHARGED, dischargedAt: new Date() },
      });

      const summary = await ipd.admissionFinancialSummary(admissionId);
      expect(summary.lineItems).toHaveLength(1);
      expect(summary.summary.totalAmount).toBe('500');
    });
  });
});
