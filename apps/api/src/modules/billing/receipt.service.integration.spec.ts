import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BenefitOutcome } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../catalog/pricing.service';
import { DocumentSequenceService } from '../../common/sequence/document-sequence.service';
import { ChargeService } from './charge.service';
import { ReceiptService } from './receipt.service';

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDb('ReceiptService (integration)', () => {
  let prisma: PrismaService;
  let charges: ChargeService;
  let receipts: ReceiptService;

  let categoryId: string;
  const createdServiceIds: string[] = [];
  const createdVisitIds: string[] = [];
  const createdEmployeeIds: string[] = [];

  const uniqueSuffix = () => Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);

  async function makePricedService(amount: number) {
    const svc = await prisma.service.create({
      data: {
        code: `ZZRCPT-${uniqueSuffix()}`,
        name: 'Receipt Test Service',
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

  async function makeVisit() {
    const permanentType = await prisma.employmentType.findFirstOrThrow({
      where: { code: 'PERMANENT' },
    });
    const post = await prisma.post.findFirstOrThrow();
    const grade = await prisma.grade.findFirstOrThrow();

    const employee = await prisma.employee.create({
      data: {
        employeeId: `ZZ-RCPT-${uniqueSuffix()}`,
        name: 'Receipt Test Patient',
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
    return visit.id;
  }

  // This suite issues real receipts to exercise DocumentSequenceService end to
  // end, which consumes real RECEIPT numbers. Captured and restored below so
  // running the suite leaves no gap in production receipt numbering.
  let originalReceiptSequenceValue: number | null;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const pricing = new PricingService(prisma);
    charges = new ChargeService(prisma, pricing);
    receipts = new ReceiptService(prisma, new DocumentSequenceService(prisma));

    const category = await prisma.serviceCategory.upsert({
      where: { code: 'ZZRCPTCAT' },
      update: {},
      create: { code: 'ZZRCPTCAT', name: 'Receipt Test Category', sortOrder: 999 },
    });
    categoryId = category.id;

    const existing = await prisma.documentSequence.findUnique({
      where: { name_periodKey: { name: 'RECEIPT', periodKey: String(new Date().getFullYear()) } },
      select: { lastValue: true },
    });
    originalReceiptSequenceValue = existing?.lastValue ?? null;
  });

  afterAll(async () => {
    await prisma.chargeItem.deleteMany({ where: { visitId: { in: createdVisitIds } } });
    await prisma.receipt.deleteMany({ where: { visitId: { in: createdVisitIds } } });
    await prisma.visit.deleteMany({ where: { id: { in: createdVisitIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: createdEmployeeIds } } });
    await prisma.servicePrice.deleteMany({ where: { serviceId: { in: createdServiceIds } } });
    await prisma.service.deleteMany({ where: { id: { in: createdServiceIds } } });
    await prisma.serviceCategory.deleteMany({ where: { code: 'ZZRCPTCAT' } });

    const periodKey = String(new Date().getFullYear());
    if (originalReceiptSequenceValue === null) {
      await prisma.documentSequence.deleteMany({ where: { name: 'RECEIPT', periodKey } });
    } else {
      await prisma.documentSequence.updateMany({
        where: { name: 'RECEIPT', periodKey },
        data: { lastValue: originalReceiptSequenceValue },
      });
    }

    await prisma.$disconnect();
  });

  it('issues one receipt covering several charges raised together', async () => {
    const visitId = await makeVisit();
    const svcA = await makePricedService(150);
    const svcB = await makePricedService(50);

    const a = await charges.postServiceCharge({ visitId, serviceId: svcA.id }, BenefitOutcome.PAID);
    const b = await charges.postServiceCharge({ visitId, serviceId: svcB.id }, BenefitOutcome.PAID);

    const receipt = await receipts.issue({ chargeIds: [a.id, b.id] });

    expect(receipt.lines).toHaveLength(2);
    expect(receipt.totalAmount).toBe('200');
    expect(receipt.receiptNumber).toMatch(/^RCPT\/\d{4}\/\d{6}$/);

    const rows = await prisma.chargeItem.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(rows.every((r) => r.status === 'PAID')).toBe(true);
    expect(new Set(rows.map((r) => r.receiptId)).size).toBe(1);
  });

  it('renders the amount in words matching the reference receipt style', async () => {
    const visitId = await makeVisit();
    const svc = await makePricedService(300);
    const charge = await charges.postServiceCharge({ visitId, serviceId: svc.id }, BenefitOutcome.PAID);

    const receipt = await receipts.issue({ chargeIds: [charge.id] });
    expect(receipt.amountInWords).toBe('Three Hundred Rupees And Zero Paise Only');
  });

  it('refuses to mix charges from two different visits onto one receipt', async () => {
    const visit1 = await makeVisit();
    const visit2 = await makeVisit();
    const svc = await makePricedService(100);

    const a = await charges.postServiceCharge({ visitId: visit1, serviceId: svc.id }, BenefitOutcome.PAID);
    const b = await charges.postServiceCharge({ visitId: visit2, serviceId: svc.id }, BenefitOutcome.PAID);

    await expect(receipts.issue({ chargeIds: [a.id, b.id] })).rejects.toThrow(BadRequestException);
  });

  it('refuses to receipt a charge that is not PENDING', async () => {
    const visitId = await makeVisit();
    const svc = await makePricedService(100);
    const charge = await charges.postServiceCharge(
      { visitId, serviceId: svc.id },
      BenefitOutcome.COVERED,
    );
    // A receipt is now the only thing that marks a charge PAID, so collect it
    // once to reach the non-PENDING state this test is about.
    await receipts.issue({ chargeIds: [charge.id] });

    await expect(receipts.issue({ chargeIds: [charge.id] })).rejects.toThrow(BadRequestException);
  });

  it('refuses to receipt the same charge twice', async () => {
    const visitId = await makeVisit();
    const svc = await makePricedService(100);
    const charge = await charges.postServiceCharge({ visitId, serviceId: svc.id }, BenefitOutcome.PAID);

    await receipts.issue({ chargeIds: [charge.id] });
    await expect(receipts.issue({ chargeIds: [charge.id] })).rejects.toThrow(BadRequestException);
  });

  it('refuses an empty charge list', async () => {
    await expect(receipts.issue({ chargeIds: [] })).rejects.toThrow(BadRequestException);
  });

  it('refuses a charge id that does not exist', async () => {
    await expect(
      receipts.issue({ chargeIds: ['00000000-0000-0000-0000-000000000000'] }),
    ).rejects.toThrow(NotFoundException);
  });

  it('issues sequential receipt numbers with no duplicates under concurrent issuance', async () => {
    const visitId = await makeVisit();
    const svc = await makePricedService(10);

    const chargeIds = await Promise.all(
      Array.from({ length: 5 }, () =>
        charges.postServiceCharge({ visitId, serviceId: svc.id }, BenefitOutcome.PAID).then((c) => c.id),
      ),
    );

    const issued = await Promise.all(chargeIds.map((id) => receipts.issue({ chargeIds: [id] })));
    const numbers = issued.map((r) => r.receiptNumber);
    expect(new Set(numbers).size).toBe(5);
  });

  it('allows only ONE of two concurrent issue() calls for the SAME chargeIds to succeed (regression: previously both could create a receipt)', async () => {
    const visitId = await makeVisit();
    const svc = await makePricedService(50);
    const charge = await charges.postServiceCharge({ visitId, serviceId: svc.id }, BenefitOutcome.PAID);

    const results = await Promise.allSettled([
      receipts.issue({ chargeIds: [charge.id] }),
      receipts.issue({ chargeIds: [charge.id] }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Confirm the charge itself ended up PAID against exactly one receipt,
    // not silently re-receipted by the loser.
    const finalCharge = await prisma.chargeItem.findUniqueOrThrow({ where: { id: charge.id } });
    expect(finalCharge.status).toBe('PAID');
    expect(finalCharge.receiptId).toBeTruthy();
  });

  it('reads back correctly through the same client that wrote it (regression: read-your-own-write inside a transaction)', async () => {
    // This reproduces the exact shape of pharmacy.service.ts's call: issue()
    // invoked with an explicit transaction client, from inside a still-open
    // transaction, must be able to read back what it just wrote.
    const visitId = await makeVisit();
    const svc = await makePricedService(75);
    const charge = await charges.postServiceCharge({ visitId, serviceId: svc.id }, BenefitOutcome.PAID);

    const receipt = await prisma.$transaction((tx) => receipts.issue({ chargeIds: [charge.id] }, tx));

    expect(receipt.totalAmount).toBe('75');
    expect(receipt.lines).toHaveLength(1);
  });
});
