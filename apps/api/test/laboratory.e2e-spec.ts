import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

/**
 * Laboratory module (e2e): first automated HTTP-level coverage. Covers
 * listing/reading, RBAC (LabTechnician can enter results but never verify --
 * only Pathologist holds LabResult:verify, per the controller's own comment),
 * and the order status state machine's guards using pre-seeded orders at
 * each status (collectSample/enterResults themselves also post billing
 * charges via ChargeService/PricingService, already covered by
 * charge.service.spec.ts -- re-mocking that whole chain a third time this
 * session wasn't worth it for what this spec needs to prove).
 */
describe('Laboratory Module (e2e)', () => {
  let app: INestApplication;
  let doctorToken: string;
  let labTechToken: string;
  let pathologistToken: string;

  const rolesStore: any[] = [
    { id: 'r-doctor', name: 'Doctor', isSystemRole: true },
    { id: 'r-labtech', name: 'LabTechnician', isSystemRole: true },
    { id: 'r-patho', name: 'Pathologist', isSystemRole: true },
  ];
  const permissionsStore: any[] = [
    { id: 'p1', roleId: 'r-doctor', resource: 'LabTest', action: 'read' },
    { id: 'p2', roleId: 'r-doctor', resource: 'LabOrder', action: 'create' },
    { id: 'p3', roleId: 'r-doctor', resource: 'LabOrder', action: 'read' },
    { id: 'p4', roleId: 'r-labtech', resource: 'LabTest', action: 'read' },
    { id: 'p5', roleId: 'r-labtech', resource: 'LabOrder', action: 'read' },
    { id: 'p6', roleId: 'r-labtech', resource: 'LabSample', action: 'create' },
    { id: 'p7', roleId: 'r-labtech', resource: 'LabResult', action: 'create' },
    { id: 'p8', roleId: 'r-patho', resource: 'LabOrder', action: 'read' },
    { id: 'p9', roleId: 'r-patho', resource: 'LabResult', action: 'verify' },
    { id: 'p10', roleId: 'r-patho', resource: 'LabReport', action: 'read' },
  ];
  const usersStore: any[] = [];

  const visitId = '11111111-1111-4111-8111-111111111111';
  const testId = '22222222-2222-4222-8222-222222222222';
  const orderedId = '33333333-3333-4333-8333-333333333333';
  const resultEnteredId = '44444444-4444-4444-8444-444444444444';
  const verifiedId = '55555555-5555-4555-8555-555555555555';

  const labTest = {
    id: testId,
    code: 'LT-CBC',
    name: 'Complete Blood Count',
    discipline: 'HAEMATOLOGY',
    specimenType: 'Blood',
    service: { code: 'LAB-CBC', name: 'Complete Blood Count' },
    _count: { parameters: 5 },
  };

  const ordersStore: any[] = [
    { id: orderedId, labNumber: 'LAB/2026/00001', visitId, status: 'ORDERED', items: [{ id: 'item-1', labTestId: testId, labTest }] },
    { id: resultEnteredId, labNumber: 'LAB/2026/00002', visitId, status: 'RESULT_ENTERED', items: [{ id: 'item-2', labTestId: testId, labTest }] },
    {
      id: verifiedId,
      labNumber: 'LAB/2026/00003',
      visitId,
      status: 'REPORTED',
      items: [{ id: 'item-3', labTestId: testId, labTest, results: [] }],
      report: { id: 'report-1', releasedAt: new Date('2026-01-01'), verifiedAt: new Date('2026-01-01'), pathologistRemarks: null, verifiedBy: { identifier: 'pathologist@esic.gov.in' } },
      sample: { collectedAt: new Date('2026-01-01'), collectedBy: { identifier: 'labtech@esic.gov.in' } },
      orderingDoctor: { identifier: 'doctor@esic.gov.in', employee: { name: 'Dr. Test' } },
      visit: {
        employee: { employeeId: 'EMP-1001', name: 'QA Test Patient', hospitalUid: null, patientProfile: null },
        opdVisit: null,
        admissions: [],
      },
    },
  ];

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    $queryRaw: jest.fn().mockResolvedValue([{ last_value: 4 }]),
    role: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => rolesStore.find((r) => r.id === where?.id || r.name === where?.name) || null),
    },
    user: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const user = usersStore.find((u) => u.id === where?.id || u.identifier === where?.identifier);
        if (!user) return null;
        const role = rolesStore.find((r) => r.id === user.roleId);
        const perms = permissionsStore.filter((p) => p.roleId === user.roleId);
        return { ...user, role: { ...role, permissions: perms } };
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    loginActivity: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    visit: { findUnique: jest.fn().mockImplementation(async ({ where }) => (where.id === visitId ? { id: visitId } : null)) },
    labTest: {
      findMany: jest.fn().mockImplementation(async ({ where }: any) => {
        if (where?.id?.in) return where.id.in.every((id: string) => id === testId) ? [labTest] : [];
        if (where?.discipline) return where.discipline === labTest.discipline ? [labTest] : [];
        return [labTest];
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }) => (where.id === testId ? labTest : null)),
    },
    labOrder: {
      findMany: jest.fn().mockImplementation(async ({ where }: any) =>
        ordersStore.filter((o) => (where?.status ? o.status === where.status : true) && (where?.visitId ? o.visitId === where.visitId : true)),
      ),
      findUnique: jest.fn().mockImplementation(async ({ where }) => ordersStore.find((o) => o.id === where.id) ?? null),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = {
          id: '66666666-6666-4666-8666-666666666666',
          labNumber: 'LAB/2026/00004',
          status: 'ORDERED',
          ...data,
          items: data.items.create.map((i: any, idx: number) => ({ id: `new-item-${idx}`, labTestId: i.labTestId, labTest })),
        };
        ordersStore.push(created);
        return created;
      }),
    },
  };

  beforeAll(async () => {
    const doctorHash = await bcrypt.hash('DoctorPass123!', 10);
    const labTechHash = await bcrypt.hash('LabTechPass123!', 10);
    const pathoHash = await bcrypt.hash('PathologistPass123!', 10);
    usersStore.push(
      { id: 'u-doctor', identifier: 'doctor@esic.gov.in', passwordHash: doctorHash, roleId: 'r-doctor', active: true },
      { id: 'u-labtech', identifier: 'labtech@esic.gov.in', passwordHash: labTechHash, roleId: 'r-labtech', active: true },
      { id: 'u-patho', identifier: 'pathologist@esic.gov.in', passwordHash: pathoHash, roleId: 'r-patho', active: true },
    );

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [
        { identifier: 'doctor@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
        { identifier: 'labtech@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
        { identifier: 'pathologist@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
      ],
      mockPrismaService,
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(PlatformPrismaService)
      .useValue(platformPrismaMock)
      .overrideProvider(TenantClientFactory)
      .useValue(tenantClientFactoryMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    doctorToken = (
      await request(app.getHttpServer()).post('/api/auth/login').send({ identifier: 'doctor@esic.gov.in', password: 'DoctorPass123!' }).expect(200)
    ).body.accessToken;
    labTechToken = (
      await request(app.getHttpServer()).post('/api/auth/login').send({ identifier: 'labtech@esic.gov.in', password: 'LabTechPass123!' }).expect(200)
    ).body.accessToken;
    pathologistToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'pathologist@esic.gov.in', password: 'PathologistPass123!' })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/lab/tests lists the test catalogue', async () => {
    const res = await request(app.getHttpServer()).get('/api/lab/tests').set('Authorization', `Bearer ${doctorToken}`).expect(200);
    expect(res.body).toEqual([labTest]);
  });

  it('POST /api/lab/orders creates an order for a doctor', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/lab/orders')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ visitId, labTestIds: [testId], priority: 'ROUTINE' })
      .expect(201);
    expect(res.body.status).toBe('ORDERED');
    expect(res.body.items).toHaveLength(1);
  });

  it('POST /api/lab/orders is rejected for a role without LabOrder:create (LabTechnician)', async () => {
    await request(app.getHttpServer())
      .post('/api/lab/orders')
      .set('Authorization', `Bearer ${labTechToken}`)
      .send({ visitId, labTestIds: [testId] })
      .expect(403);
  });

  it('POST /api/lab/orders rejects an unknown lab test id', async () => {
    await request(app.getHttpServer())
      .post('/api/lab/orders')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ visitId, labTestIds: ['99999999-9999-4999-8999-999999999999'] })
      .expect(400);
  });

  it('GET /api/lab/queue lists orders, optionally filtered by status', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/lab/queue?status=ORDERED')
      .set('Authorization', `Bearer ${labTechToken}`)
      .expect(200);
    expect(res.body.some((o: any) => o.id === orderedId)).toBe(true);
    expect(res.body.every((o: any) => o.status === 'ORDERED')).toBe(true);
  });

  it('POST /api/lab/orders/:id/verify rejects an order before results are entered (still ORDERED)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/lab/orders/${orderedId}/verify`)
      .set('Authorization', `Bearer ${pathologistToken}`)
      .send({})
      .expect(400);
    expect(res.body.message).toMatch(/must have results entered/i);
  });

  it('POST /api/lab/orders/:id/verify is rejected for LabTechnician (only Pathologist holds LabResult:verify)', async () => {
    await request(app.getHttpServer())
      .post(`/api/lab/orders/${resultEnteredId}/verify`)
      .set('Authorization', `Bearer ${labTechToken}`)
      .send({})
      .expect(403);
  });

  it('GET /api/lab/orders/:id/report rejects an unverified order with a clear 400 (not a crash)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/lab/orders/${resultEnteredId}/report`)
      .set('Authorization', `Bearer ${pathologistToken}`)
      .expect(400);
    expect(res.body.message).toMatch(/has not been verified/i);
  });

  it('GET /api/lab/orders/:id/report succeeds once an order is REPORTED', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/lab/orders/${verifiedId}/report`)
      .set('Authorization', `Bearer ${pathologistToken}`)
      .expect(200);
    expect(res.body.labNumber).toBe('LAB/2026/00003');
    expect(res.body.verification.pathologist).toBe('pathologist@esic.gov.in');
  });

  it('GET /api/lab/orders/:id 404s for an unknown order', async () => {
    await request(app.getHttpServer())
      .get('/api/lab/orders/77777777-7777-4777-8777-777777777777')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(404);
  });

  it('rejects malformed order ids with a clean 400, not a 500 (ParseUUIDPipe)', async () => {
    await request(app.getHttpServer())
      .get('/api/lab/orders/not-a-uuid')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(400);
  });
});
