import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LabOrderStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DocumentSequenceService } from '../../common/sequence/document-sequence.service';
import { PricingService } from '../catalog/pricing.service';
import { ChargeService } from '../billing/charge.service';
import { BenefitRuleService } from '../benefit/benefit-rule.service';
import { LabService } from './lab.service';

/**
 * Integration tests against the real database — the workflow gate under test
 * ("a technician's entry is never the final report") is an RBAC/service-layer
 * rule that only means something when exercised against real transitions and
 * real CHECK constraints on the resulting charges.
 */
const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDb('LabService (integration)', () => {
  let prisma: PrismaService;
  let lab: LabService;
  let benefitRules: BenefitRuleService;

  let doctorId: string;
  let technicianId: string;
  let pathologistId: string;
  let cbcTestId: string;

  const createdVisitIds: string[] = [];
  const createdEmployeeIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdAdmissionIds: string[] = [];

  // This suite issues real lab orders and samples, consuming real LAB_NUMBER
  // and SAMPLE_CODE sequence values. Captured and restored so running it
  // leaves no gap in production numbering.
  const originalSequenceValues = new Map<string, number | null>();

  const uniqueSuffix = () => Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);

  async function makeVisit() {
    const permanentType = await prisma.employmentType.findFirstOrThrow({ where: { code: 'PERMANENT' } });
    const post = await prisma.post.findFirstOrThrow();
    const grade = await prisma.grade.findFirstOrThrow();
    const employee = await prisma.employee.create({
      data: {
        employeeId: `ZZ-LAB-${uniqueSuffix()}`,
        name: 'Lab Test Patient',
        department: 'Test',
        postId: post.id,
        gradeId: grade.id,
        employmentTypeId: permanentType.id,
      },
    });
    createdEmployeeIds.push(employee.id);
    const visit = await prisma.visit.create({ data: { employeeId: employee.id, type: 'OPD', status: 'OPEN' } });
    createdVisitIds.push(visit.id);
    return visit.id;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const pricing = new PricingService(prisma);
    const sequences = new DocumentSequenceService(prisma);
    const charges = new ChargeService(prisma, pricing);
    benefitRules = new BenefitRuleService(prisma);
    lab = new LabService(prisma, sequences, charges, benefitRules);

    doctorId = (await prisma.user.findFirstOrThrow({ where: { role: { name: 'Doctor' } } })).id;
    technicianId = (await prisma.user.findFirstOrThrow({ where: { role: { name: 'LabTechnician' } } })).id;
    pathologistId = (await prisma.user.findFirstOrThrow({ where: { role: { name: 'Pathologist' } } })).id;
    cbcTestId = (await prisma.labTest.findUniqueOrThrow({ where: { code: 'LT-CBC' } })).id;

    const periodKey = String(new Date().getFullYear());
    for (const name of ['LAB', 'SAMPLE']) {
      const row = await prisma.documentSequence.findUnique({
        where: { name_periodKey: { name, periodKey } },
        select: { lastValue: true },
      });
      originalSequenceValues.set(name, row?.lastValue ?? null);
    }
  });

  afterAll(async () => {
    for (const orderId of createdOrderIds) {
      await prisma.chargeItem.deleteMany({ where: { labOrderItem: { labOrderId: orderId } } });
      await prisma.labResult.deleteMany({ where: { labOrderItem: { labOrderId: orderId } } });
      await prisma.labReport.deleteMany({ where: { labOrderId: orderId } });
      await prisma.labSample.deleteMany({ where: { labOrderId: orderId } });
      await prisma.labOrderItem.deleteMany({ where: { labOrderId: orderId } });
      await prisma.labOrder.deleteMany({ where: { id: orderId } });
    }
    await prisma.admission.deleteMany({ where: { id: { in: createdAdmissionIds } } });
    await prisma.visit.deleteMany({ where: { id: { in: createdVisitIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: createdEmployeeIds } } });

    const periodKey = String(new Date().getFullYear());
    for (const [name, original] of originalSequenceValues) {
      if (original === null) {
        await prisma.documentSequence.deleteMany({ where: { name, periodKey } });
      } else {
        await prisma.documentSequence.updateMany({ where: { name, periodKey }, data: { lastValue: original } });
      }
    }

    await prisma.$disconnect();
  });

  async function makeCollectedOrder() {
    const visitId = await makeVisit();
    const order = await lab.orderTests({ visitId, labTestIds: [cbcTestId] }, doctorId);
    createdOrderIds.push(order.id);
    await lab.collectSample(order.id, undefined, technicianId);
    return { visitId, order };
  }

  /** A visit with a real Admission attached, for cross-visit admissionId checks. */
  async function makeIpdAdmission() {
    const visitId = await makeVisit();
    const admission = await prisma.admission.create({ data: { visitId, status: 'UNDER_TREATMENT' } });
    createdAdmissionIds.push(admission.id);
    return { visitId, admissionId: admission.id };
  }

  describe('workflow order', () => {
    it('moves ORDERED → SAMPLE_COLLECTED → RESULT_ENTERED → REPORTED', async () => {
      const { order } = await makeCollectedOrder();
      let current = await prisma.labOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(current.status).toBe(LabOrderStatus.SAMPLE_COLLECTED);
      expect(current.labNumber).toMatch(/^LAB\/\d{4}\/\d{5}$/);

      const item = (await prisma.labOrderItem.findFirstOrThrow({ where: { labOrderId: order.id } }));
      const params = await prisma.labTestParameter.findMany({ where: { labTestId: cbcTestId } });

      await lab.enterResults(
        { labOrderItemId: item.id, results: params.map((p) => ({ parameterId: p.id, value: '10' })) },
        technicianId,
      );
      current = await prisma.labOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(current.status).toBe(LabOrderStatus.RESULT_ENTERED);

      await lab.verifyOrder(order.id, 'Looks fine', pathologistId);
      current = await prisma.labOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(current.status).toBe(LabOrderStatus.REPORTED);
    });

    it('refuses to collect a sample twice', async () => {
      const { order } = await makeCollectedOrder();
      await expect(lab.collectSample(order.id, undefined, technicianId)).rejects.toThrow(BadRequestException);
    });

    it('refuses to enter results before the sample is collected', async () => {
      const visitId = await makeVisit();
      const order = await lab.orderTests({ visitId, labTestIds: [cbcTestId] }, doctorId);
      createdOrderIds.push(order.id);
      const item = await prisma.labOrderItem.findFirstOrThrow({ where: { labOrderId: order.id } });

      await expect(
        lab.enterResults({ labOrderItemId: item.id, results: [{ parameterId: 'x', value: '1' }] }, technicianId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("Feature 6 — a technician's entry is never the final report", () => {
    it('refuses to verify before every item has results entered', async () => {
      const { order } = await makeCollectedOrder();
      await expect(lab.verifyOrder(order.id, undefined, pathologistId)).rejects.toThrow(BadRequestException);
    });

    it('refuses to re-enter results once verified', async () => {
      const { order } = await makeCollectedOrder();
      const item = await prisma.labOrderItem.findFirstOrThrow({ where: { labOrderId: order.id } });
      const params = await prisma.labTestParameter.findMany({ where: { labTestId: cbcTestId } });
      await lab.enterResults(
        { labOrderItemId: item.id, results: params.map((p) => ({ parameterId: p.id, value: '10' })) },
        technicianId,
      );
      await lab.verifyOrder(order.id, undefined, pathologistId);

      await expect(
        lab.enterResults({ labOrderItemId: item.id, results: [{ parameterId: params[0].id, value: '99' }] }, technicianId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('produces no report until verifyOrder has actually run', async () => {
      const { order } = await makeCollectedOrder();
      const item = await prisma.labOrderItem.findFirstOrThrow({ where: { labOrderId: order.id } });
      const params = await prisma.labTestParameter.findMany({ where: { labTestId: cbcTestId } });
      await lab.enterResults(
        { labOrderItemId: item.id, results: params.map((p) => ({ parameterId: p.id, value: '10' })) },
        technicianId,
      );

      await expect(lab.getReport(order.id)).rejects.toThrow(BadRequestException);

      const report = await prisma.labReport.findUnique({ where: { labOrderId: order.id } });
      expect(report).toBeNull();
    });
  });

  describe('admissionId cross-check (F-27)', () => {
    it('refuses an admissionId that belongs to a different visit', async () => {
      const { admissionId } = await makeIpdAdmission();
      const otherVisitId = await makeVisit();

      await expect(
        lab.orderTests({ visitId: otherVisitId, labTestIds: [cbcTestId], admissionId }, doctorId),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses an admissionId that does not exist', async () => {
      const visitId = await makeVisit();

      await expect(
        lab.orderTests(
          { visitId, labTestIds: [cbcTestId], admissionId: '00000000-0000-0000-0000-000000000000' },
          doctorId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('accepts an admissionId that genuinely belongs to the same visit', async () => {
      const { visitId, admissionId } = await makeIpdAdmission();

      const order = await lab.orderTests({ visitId, labTestIds: [cbcTestId], admissionId }, doctorId);
      createdOrderIds.push(order.id);

      expect(order.admissionId).toBe(admissionId);
    });
  });

  describe('charge integrity', () => {
    it('posts one charge per test at collection, each citing the service and the order item', async () => {
      const { order } = await makeCollectedOrder();
      const item = await prisma.labOrderItem.findFirstOrThrow({ where: { labOrderId: order.id } });

      const charge = await prisma.chargeItem.findFirst({ where: { labOrderItemId: item.id } });
      expect(charge).not.toBeNull();
      expect(charge!.serviceId).not.toBeNull();
      expect(charge!.servicePriceId).not.toBeNull();
      expect(charge!.prescriptionItemId).toBeNull();
    });

    it('never posts a charge for an order that is only ORDERED, not collected', async () => {
      const visitId = await makeVisit();
      const order = await lab.orderTests({ visitId, labTestIds: [cbcTestId] }, doctorId);
      createdOrderIds.push(order.id);
      const item = await prisma.labOrderItem.findFirstOrThrow({ where: { labOrderId: order.id } });

      const charge = await prisma.chargeItem.findFirst({ where: { labOrderItemId: item.id } });
      expect(charge).toBeNull();
    });
  });

  describe('calculated parameters', () => {
    it('derives Indirect Bilirubin from Total and Direct on LFT', async () => {
      const lftId = (await prisma.labTest.findUniqueOrThrow({ where: { code: 'LT-LFT' } })).id;
      const visitId = await makeVisit();
      const order = await lab.orderTests({ visitId, labTestIds: [lftId] }, doctorId);
      createdOrderIds.push(order.id);
      await lab.collectSample(order.id, undefined, technicianId);
      const item = await prisma.labOrderItem.findFirstOrThrow({ where: { labOrderId: order.id } });

      const total = await prisma.labTestParameter.findFirstOrThrow({
        where: { labTestId: lftId, name: 'Serum Bilirubin - Total' },
      });
      const direct = await prisma.labTestParameter.findFirstOrThrow({
        where: { labTestId: lftId, name: 'Serum Bilirubin - Direct' },
      });
      const indirect = await prisma.labTestParameter.findFirstOrThrow({
        where: { labTestId: lftId, name: 'Serum Bilirubin - Indirect' },
      });

      await lab.enterResults(
        {
          labOrderItemId: item.id,
          results: [
            { parameterId: total.id, value: '0.6' },
            { parameterId: direct.id, value: '0.2' },
          ],
        },
        technicianId,
      );

      const indirectResult = await prisma.labResult.findUnique({
        where: { labOrderItemId_parameterId: { labOrderItemId: item.id, parameterId: indirect.id } },
      });
      expect(indirectResult).not.toBeNull();
      expect(Number(indirectResult!.value)).toBeCloseTo(0.4, 2);
    });

    it('flags a value outside its reference range as HIGH or LOW', async () => {
      const { order } = await makeCollectedOrder();
      const item = await prisma.labOrderItem.findFirstOrThrow({ where: { labOrderId: order.id } });
      const hb = await prisma.labTestParameter.findFirstOrThrow({
        where: { labTestId: cbcTestId, name: 'Haemoglobin' },
      });

      await lab.enterResults({ labOrderItemId: item.id, results: [{ parameterId: hb.id, value: '5' }] }, technicianId);

      const result = await prisma.labResult.findUnique({
        where: { labOrderItemId_parameterId: { labOrderItemId: item.id, parameterId: hb.id } },
      });
      expect(result!.flag).toBe('LOW');
    });
  });
});
