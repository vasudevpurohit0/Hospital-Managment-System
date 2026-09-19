import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LabOrderItemStatus, LabOrderStatus, LabResultFlag } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  DocumentSequenceService,
  PrismaClientLike,
} from '../../common/sequence/document-sequence.service';
import { ChargeService } from '../billing/charge.service';
import { BenefitRuleService } from '../benefit/benefit-rule.service';
import { CreateLabOrderDto, EnterResultsDto } from './dto/lab.dto';

/**
 * Derivations computed from sibling results on the same order item, keyed by
 * the CALCULATED parameter's name. Documents the same formulas recorded (as
 * text, for the printed report) on LabTestParameter.formula — this is where
 * they are actually evaluated, from real entered values, never guessed.
 */
const CALCULATIONS: Record<string, (v: Record<string, number>) => number | null> = {
  'Serum Bilirubin - Indirect': (v) =>
    has(v, 'Serum Bilirubin - Total', 'Serum Bilirubin - Direct')
      ? v['Serum Bilirubin - Total'] - v['Serum Bilirubin - Direct']
      : null,
  'Urea/Creatinine Ratio': (v) =>
    has(v, 'Urea', 'Creatinine') && v['Creatinine'] !== 0 ? v['Urea'] / v['Creatinine'] : null,
  'VLDL Cholesterol': (v) => (has(v, 'Triglycerides') ? v['Triglycerides'] / 5 : null),
  'LDL Cholesterol': (v) =>
    has(v, 'Total Cholesterol', 'HDL Cholesterol', 'Triglycerides')
      ? v['Total Cholesterol'] - v['HDL Cholesterol'] - v['Triglycerides'] / 5
      : null,
  'TC / HDL Cholesterol Ratio': (v) =>
    has(v, 'Total Cholesterol', 'HDL Cholesterol') && v['HDL Cholesterol'] !== 0
      ? v['Total Cholesterol'] / v['HDL Cholesterol']
      : null,
  'LDL / HDL Ratio': (v) => {
    if (!has(v, 'Total Cholesterol', 'HDL Cholesterol', 'Triglycerides') || v['HDL Cholesterol'] === 0)
      return null;
    const ldl = v['Total Cholesterol'] - v['HDL Cholesterol'] - v['Triglycerides'] / 5;
    return ldl / v['HDL Cholesterol'];
  },
  // ADA/ADAG estimated average glucose from HbA1c.
  'Average Blood Glucose (ABG)': (v) => (has(v, 'HbA1c') ? 28.7 * v['HbA1c'] - 46.7 : null),
};

function has(v: Record<string, number>, ...keys: string[]): boolean {
  return keys.every((k) => Number.isFinite(v[k]));
}

@Injectable()
export class LabService {
  private readonly logger = new Logger(LabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
    private readonly charges: ChargeService,
    private readonly benefitRules: BenefitRuleService,
  ) {}

  /** The Lab Test Master catalogue — clinical definitions, not prices (those live in Service/ServicePrice). */
  async listTests(discipline?: string) {
    return this.prisma.labTest.findMany({
      where: discipline ? { discipline: discipline as never } : undefined,
      include: { service: { select: { code: true, name: true } }, _count: { select: { parameters: true } } },
      orderBy: [{ discipline: 'asc' }, { name: 'asc' }],
    });
  }

  async getTest(id: string) {
    const test = await this.prisma.labTest.findUnique({
      where: { id },
      include: {
        service: true,
        parameters: { include: { ranges: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!test) throw new NotFoundException(`Lab test not found: ${id}`);
    return test;
  }

  /**
   * Doctor orders one or more investigations under a single Lab Order
   * (Feature 6). Accepts an optional transaction so a caller that creates the
   * order alongside other records (e.g. a prescription and its diagnosis)
   * can do so atomically — the order should never exist without whatever
   * clinical act prompted it.
   */
  async orderTests(dto: CreateLabOrderDto, doctorId: string, tx?: PrismaClientLike) {
    const client = tx ?? this.prisma;

    const visit = await client.visit.findUnique({ where: { id: dto.visitId } });
    if (!visit) throw new NotFoundException(`Visit not found: ${dto.visitId}`);

    const tests = await client.labTest.findMany({ where: { id: { in: dto.labTestIds } } });
    if (tests.length !== new Set(dto.labTestIds).size) {
      throw new BadRequestException('One or more lab tests do not exist.');
    }

    const run = async (t: PrismaClientLike) => {
      const labNumber = await this.sequences.next('LAB_NUMBER', t);

      const order = await t.labOrder.create({
        data: {
          labNumber,
          visitId: dto.visitId,
          admissionId: dto.admissionId ?? null,
          orderedBy: doctorId,
          priority: dto.priority as never,
          clinicalNotes: dto.clinicalNotes ?? null,
          status: LabOrderStatus.ORDERED,
          items: { create: dto.labTestIds.map((labTestId) => ({ labTestId })) },
        },
        include: { items: { include: { labTest: true } } },
      });

      this.logger.log(`Ordered ${order.items.length} test(s) as ${labNumber} for visit ${dto.visitId}`);
      return order;
    };

    return tx ? run(tx) : this.prisma.$transaction((t) => run(t));
  }

  /**
   * Pending-collection / processing / awaiting-verification queues for the
   * workbench, optionally scoped to one visit — the same list a doctor sees
   * in Consultations when reviewing what's already been ordered for the
   * patient in front of them.
   */
  async listQueue(status?: LabOrderStatus, visitId?: string) {
    return this.prisma.labOrder.findMany({
      where: {
        ...(status ? { status } : { status: { not: LabOrderStatus.CANCELLED } }),
        ...(visitId ? { visitId } : {}),
      },
      include: {
        items: { include: { labTest: true } },
        sample: true,
        visit: { include: { employee: { include: { hospitalUid: true } } } },
        orderingDoctor: { select: { identifier: true, employee: { select: { name: true } } } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /** One order's full detail — items, their test's parameters (for the result-entry form), and any results already entered. */
  async getOrder(labOrderId: string) {
    const order = await this.prisma.labOrder.findUnique({
      where: { id: labOrderId },
      include: {
        items: {
          include: {
            labTest: { include: { parameters: { include: { ranges: true }, orderBy: { sortOrder: 'asc' } } } },
            results: { include: { parameter: true } },
          },
        },
        sample: true,
        report: true,
        visit: { include: { employee: { include: { hospitalUid: true } } } },
        orderingDoctor: { select: { identifier: true, employee: { select: { name: true } } } },
      },
    });
    if (!order) throw new NotFoundException(`Lab order not found: ${labOrderId}`);
    return order;
  }

  /**
   * Collects the specimen and posts one charge per item. Charges post here —
   * at collection — rather than at order, so an order cancelled before
   * collection never bills (Feature 6).
   *
   * Payment is not collected here: LabTechnician holds no Receipt permission
   * by design (see RBAC) — a PAID-outcome charge stays PENDING until
   * Reception or Admin issues a receipt for it, same as any other charge.
   */
  async collectSample(labOrderId: string, specimenType: string | undefined, userId: string) {
    const order = await this.prisma.labOrder.findUnique({
      where: { id: labOrderId },
      include: {
        items: { include: { labTest: true } },
        visit: { include: { employee: { include: { employmentType: true } } } },
      },
    });
    if (!order) throw new NotFoundException(`Lab order not found: ${labOrderId}`);
    if (order.status !== LabOrderStatus.ORDERED) {
      throw new BadRequestException(
        `Order is ${order.status}, not ORDERED — a sample can only be collected once.`,
      );
    }

    const sampleCode = await this.sequences.next('SAMPLE_CODE');
    const outcome = await this.benefitRules.evaluate(order.visit.employee.employmentType.code);

    return this.prisma.$transaction(async (tx) => {
      await tx.labSample.create({
        data: {
          labOrderId,
          sampleCode,
          specimenType: specimenType || order.items[0]?.labTest.specimenType || 'Not specified',
          collectedById: userId,
        },
      });

      for (const item of order.items) {
        await this.charges.postServiceCharge(
          {
            visitId: order.visitId,
            admissionId: order.admissionId ?? undefined,
            serviceId: item.labTest.serviceId,
            labOrderItemId: item.id,
            actorUserId: userId,
          },
          outcome,
          tx,
        );
      }

      const updated = await tx.labOrder.update({
        where: { id: labOrderId },
        data: { status: LabOrderStatus.SAMPLE_COLLECTED },
        include: { sample: true, items: true },
      });

      this.logger.log(`Collected sample ${sampleCode} for order ${order.labNumber}`);
      return updated;
    });
  }

  /**
   * Enters results for every parameter of one order item, then computes any
   * CALCULATED parameters on that same item from the values just entered.
   * Automatically flags each numeric result against the applicable reference
   * range. Advances the order to RESULT_ENTERED once every item has results.
   */
  async enterResults(dto: EnterResultsDto, userId: string) {
    const item = await this.prisma.labOrderItem.findUnique({
      where: { id: dto.labOrderItemId },
      include: {
        labTest: { include: { parameters: { include: { ranges: true } } } },
        labOrder: { include: { visit: { include: { employee: { include: { patientProfile: true } } } } } },
      },
    });
    if (!item) throw new NotFoundException(`Lab order item not found: ${dto.labOrderItemId}`);
    if (item.labOrder.status === LabOrderStatus.ORDERED) {
      throw new BadRequestException('Cannot enter results before the sample is collected.');
    }
    if (item.labOrder.status === LabOrderStatus.VERIFIED || item.labOrder.status === LabOrderStatus.REPORTED) {
      throw new ForbiddenException('This order has already been verified and cannot be re-entered here.');
    }

    const sex = item.labOrder.visit.employee.patientProfile?.gender?.toUpperCase();
    const paramByName = new Map(item.labTest.parameters.map((p) => [p.name, p]));
    const paramById = new Map(item.labTest.parameters.map((p) => [p.id, p]));

    await this.prisma.$transaction(async (tx) => {
      const numericByName: Record<string, number> = {};

      for (const entry of dto.results) {
        const param = paramById.get(entry.parameterId);
        if (!param) {
          throw new BadRequestException(`Parameter ${entry.parameterId} does not belong to this test.`);
        }
        const numeric = Number(entry.value);
        if (Number.isFinite(numeric)) numericByName[param.name] = numeric;

        const flag = this.computeFlag(numeric, param.ranges, sex);
        await tx.labResult.upsert({
          where: { labOrderItemId_parameterId: { labOrderItemId: item.id, parameterId: param.id } },
          update: { value: entry.value, flag, enteredById: userId, enteredAt: new Date() },
          create: {
            labOrderItemId: item.id,
            parameterId: param.id,
            value: entry.value,
            flag,
            enteredById: userId,
          },
        });
      }

      // Derive calculated parameters from whatever has been entered so far —
      // this run's values plus any already saved from a prior partial entry.
      const existing = await tx.labResult.findMany({ where: { labOrderItemId: item.id } });
      for (const r of existing) {
        const p = paramById.get(r.parameterId);
        if (p && Number.isFinite(Number(r.value))) numericByName[p.name] = Number(r.value);
      }

      for (const param of item.labTest.parameters) {
        if (!param.isCalculated) continue;
        const compute = CALCULATIONS[param.name];
        if (!compute) continue;
        const value = compute(numericByName);
        if (value === null) continue;

        const rounded = Math.round(value * 100) / 100;
        const flag = this.computeFlag(rounded, param.ranges, sex);
        await tx.labResult.upsert({
          where: { labOrderItemId_parameterId: { labOrderItemId: item.id, parameterId: param.id } },
          update: { value: String(rounded), flag, enteredById: userId, enteredAt: new Date() },
          create: {
            labOrderItemId: item.id,
            parameterId: param.id,
            value: String(rounded),
            flag,
            enteredById: userId,
          },
        });
      }

      await tx.labOrderItem.update({
        where: { id: item.id },
        data: { status: LabOrderItemStatus.RESULT_ENTERED },
      });

      // Advance the order once every item has at least one result.
      const allItems = await tx.labOrderItem.findMany({
        where: { labOrderId: item.labOrderId },
        include: { results: true },
      });
      if (allItems.every((i) => i.results.length > 0 || i.id === item.id)) {
        await tx.labOrder.update({
          where: { id: item.labOrderId },
          data: { status: LabOrderStatus.RESULT_ENTERED },
        });
      } else {
        await tx.labOrder.update({
          where: { id: item.labOrderId },
          data: { status: LabOrderStatus.PROCESSING },
        });
      }
    });

    return this.prisma.labOrderItem.findUnique({
      where: { id: item.id },
      include: { results: { include: { parameter: true } } },
    });
  }

  private computeFlag(
    value: number,
    ranges: { numericLow: unknown; numericHigh: unknown; sex: string }[],
    sex?: string,
  ): LabResultFlag {
    if (!Number.isFinite(value) || ranges.length === 0) return LabResultFlag.NORMAL;

    const range =
      ranges.find((r) => r.sex === sex) ?? ranges.find((r) => r.sex === 'ANY') ?? ranges[0];
    const low = range.numericLow !== null ? Number(range.numericLow) : null;
    const high = range.numericHigh !== null ? Number(range.numericHigh) : null;

    if (low !== null && value < low) return LabResultFlag.LOW;
    if (high !== null && value > high) return LabResultFlag.HIGH;
    return LabResultFlag.NORMAL;
  }

  /**
   * A technician's entry is never the final report (Feature 6): only a
   * Pathologist reaches this — enforced by RBAC at the controller and again
   * here by requiring every item to already be RESULT_ENTERED.
   */
  async verifyOrder(labOrderId: string, pathologistRemarks: string | undefined, pathologistId: string) {
    const order = await this.prisma.labOrder.findUnique({
      where: { id: labOrderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException(`Lab order not found: ${labOrderId}`);
    if (order.status !== LabOrderStatus.RESULT_ENTERED) {
      throw new BadRequestException(
        `Order is ${order.status} — every item must have results entered before verification.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.labOrderItem.updateMany({
        where: { labOrderId },
        data: { status: LabOrderItemStatus.VERIFIED },
      });

      await tx.labReport.create({
        data: { labOrderId, verifiedById: pathologistId, pathologistRemarks: pathologistRemarks ?? null },
      });

      const updated = await tx.labOrder.update({
        where: { id: labOrderId },
        data: { status: LabOrderStatus.REPORTED },
      });

      this.logger.log(`Verified and released report for order ${order.labNumber}`);
      return updated;
    });
  }

  /** The full printable report — patient, order, results, ranges, flags, signatures. */
  async getReport(labOrderId: string) {
    const order = await this.prisma.labOrder.findUnique({
      where: { id: labOrderId },
      include: {
        report: { include: { verifiedBy: { select: { identifier: true } } } },
        sample: { include: { collectedBy: { select: { identifier: true } } } },
        orderingDoctor: { select: { identifier: true, employee: { select: { name: true } } } },
        visit: {
          include: {
            employee: { include: { hospitalUid: true, patientProfile: true } },
            opdVisit: true,
            admissions: { take: 1, orderBy: { requestedAt: 'desc' } },
          },
        },
        items: {
          include: {
            labTest: true,
            results: { include: { parameter: { include: { ranges: true } } } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException(`Lab order not found: ${labOrderId}`);
    if (!order.report) {
      throw new BadRequestException('This order has not been verified — no report exists yet.');
    }

    const emp = order.visit.employee;

    return {
      labNumber: order.labNumber,
      status: order.status,
      patient: {
        uhid: emp.hospitalUid?.uidCode ?? null,
        employeeId: emp.employeeId,
        name: emp.name,
        age: emp.patientProfile?.dob
          ? Math.floor((Date.now() - emp.patientProfile.dob.getTime()) / 3.15576e10)
          : null,
        gender: emp.patientProfile?.gender ?? null,
      },
      opdOrIpdReference: order.visit.opdVisit?.tokenNumber ?? order.visit.admissions[0]?.id ?? null,
      referringDoctor: order.orderingDoctor.employee?.name ?? order.orderingDoctor.identifier,
      sampleDate: order.sample?.collectedAt ?? null,
      reportDate: order.report.releasedAt,
      panels: order.items.map((item) => ({
        testName: item.labTest.name,
        discipline: item.labTest.discipline,
        results: item.results.map((r) => ({
          parameter: r.parameter.name,
          groupLabel: r.parameter.groupLabel,
          value: r.value,
          unit: r.parameter.unit,
          range: r.parameter.ranges[0]?.displayText ?? null,
          flag: r.flag,
          interpretation: r.parameter.interpretation,
        })),
      })),
      verification: {
        technician: order.sample?.collectedBy.identifier ?? null,
        pathologist: order.report.verifiedBy.identifier,
        verifiedAt: order.report.verifiedAt,
        remarks: order.report.pathologistRemarks,
      },
    };
  }
}
