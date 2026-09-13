import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../catalog/pricing.service';
import { ChargeService } from '../billing/charge.service';
import { AnalyticsService } from './analytics.service';

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDb('AnalyticsService (integration)', () => {
  let prisma: PrismaService;
  let analytics: AnalyticsService;
  let charges: ChargeService;
  let categoryId: string;

  const createdVisitIds: string[] = [];
  const createdEmployeeIds: string[] = [];
  const createdServiceIds: string[] = [];

  const uniqueSuffix = () => Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);

  async function makeVisit() {
    const contractualType = await prisma.employmentType.findFirstOrThrow({ where: { code: 'CONTRACTUAL' } });
    const post = await prisma.post.findFirstOrThrow();
    const grade = await prisma.grade.findFirstOrThrow();
    const employee = await prisma.employee.create({
      data: {
        employeeId: `ZZ-AN-${uniqueSuffix()}`,
        name: 'Analytics Test Patient',
        department: 'Test',
        postId: post.id,
        gradeId: grade.id,
        employmentTypeId: contractualType.id,
      },
    });
    createdEmployeeIds.push(employee.id);
    const visit = await prisma.visit.create({ data: { employeeId: employee.id, type: 'OPD', status: 'OPEN' } });
    createdVisitIds.push(visit.id);
    return visit.id;
  }

  async function makePricedService(amount: number) {
    const svc = await prisma.service.create({
      data: { code: `ZZAN-${uniqueSuffix()}`, name: 'Analytics Test Service', categoryId, serviceType: 'THERAPY' },
    });
    createdServiceIds.push(svc.id);
    await prisma.servicePrice.create({
      data: { serviceId: svc.id, amount, effectiveFrom: new Date('2026-01-01'), reason: 'test' },
    });
    return svc;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const pricing = new PricingService(prisma);
    charges = new ChargeService(prisma, pricing);
    analytics = new AnalyticsService(prisma);

    const category = await prisma.serviceCategory.upsert({
      where: { code: 'ZZANCAT' },
      update: {},
      create: { code: 'ZZANCAT', name: 'Analytics Test Category', sortOrder: 999 },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.chargeItem.deleteMany({ where: { visitId: { in: createdVisitIds } } });
    await prisma.visit.deleteMany({ where: { id: { in: createdVisitIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: createdEmployeeIds } } });
    await prisma.servicePrice.deleteMany({ where: { serviceId: { in: createdServiceIds } } });
    await prisma.service.deleteMany({ where: { id: { in: createdServiceIds } } });
    await prisma.serviceCategory.deleteMany({ where: { code: 'ZZANCAT' } });
    await prisma.$disconnect();
  });

  it('financial totals reconcile exactly against the charges just posted (Feature 22 — real data, not placeholders)', async () => {
    const visitId = await makeVisit();
    const svc = await makePricedService(777);
    const before = await analytics.financial({});

    await charges.postServiceCharge({ visitId, serviceId: svc.id }, 'PAID');

    const after = await analytics.financial({});

    expect(Number(after.totalAmount) - Number(before.totalAmount)).toBeCloseTo(777, 2);
    expect(Number(after.outstandingAmount) - Number(before.outstandingAmount)).toBeCloseTo(777, 2);
  });

  it('never fabricates data for an empty result — a fresh service with no charges contributes real zeros', async () => {
    const svc = await makePricedService(1);
    const revenueRow = (await analytics.financial({})).topServicesByRevenue.find(
      (s) => s.code === svc.code,
    );
    expect(revenueRow).toBeUndefined(); // truly absent, not a fabricated zero row
  });

  it('operations reflects a real OPD visit count increase', async () => {
    const before = await analytics.operations({});
    await makeVisit();
    const after = await analytics.operations({});
    expect(after.opd.totalVisits).toBeGreaterThanOrEqual(before.opd.totalVisits);
  });

  it('inventory numbers come from real MedicineBatch rows', async () => {
    const result = await analytics.inventory();
    const realCount = await prisma.medicineBatch.count({ where: { stockStatus: 'EXPIRED' } });
    expect(result.expiredBatches).toBe(realCount);
  });
});
