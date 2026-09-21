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
 * Analytics module (e2e): first automated coverage for this controller --
 * previously reachable only by hand-testing against a live server (see
 * docs/QA-SESSION-LOG.md). Covers the happy path for all 4 endpoints plus the
 * RBAC boundary (a role without `Analytics:read` must 403, never see the
 * numbers).
 */
describe('Analytics Module (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let nurseToken: string;

  const rolesStore: any[] = [
    { id: 'r-admin', name: 'Administrator', isSystemRole: true },
    { id: 'r-nurse', name: 'Nurse', isSystemRole: true },
  ];
  const permissionsStore: any[] = [{ id: 'p1', roleId: 'r-admin', resource: 'Analytics', action: 'read' }];
  const usersStore: any[] = [];

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ avg_hours: 18.5 }]),
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
    employee: { count: jest.fn().mockResolvedValue(12) },
    visit: { count: jest.fn().mockResolvedValue(30) },
    oPDVisit: {
      groupBy: jest.fn().mockResolvedValue([{ departmentId: 'dept-1', _count: { _all: 7 } }]),
    },
    admission: {
      count: jest.fn().mockImplementation(async ({ where }: any) =>
        where?.status === 'DISCHARGED' ? 2 : 5,
      ),
    },
    bed: {
      count: jest.fn().mockImplementation(async (args?: any) => (args?.where?.status === 'OCCUPIED' ? 3 : 10)),
    },
    labOrder: {
      count: jest.fn().mockImplementation(async ({ where }: any) =>
        where?.status === 'RESULT_ENTERED' ? 4 : 20,
      ),
      groupBy: jest.fn().mockResolvedValue([{ status: 'ORDERED', _count: { _all: 20 } }]),
    },
    therapySession: { count: jest.fn().mockResolvedValue(6) },
    chargeItem: {
      count: jest.fn().mockResolvedValue(15),
      aggregate: jest.fn().mockResolvedValue({ _sum: { netAmount: 5000 } }),
      groupBy: jest.fn().mockImplementation(async ({ by }: any) => {
        if (by?.[0] === 'status') {
          return [
            { status: 'PAID', _sum: { netAmount: 3000 }, _count: { _all: 8 } },
            { status: 'PENDING', _sum: { netAmount: 2000 }, _count: { _all: 7 } },
          ];
        }
        if (by?.[0] === 'categoryName') {
          return [{ categoryName: 'Consultation', _sum: { netAmount: 3000 }, _count: { _all: 10 } }];
        }
        return [{ serviceId: 'svc-1', _sum: { netAmount: 1000 }, _count: { _all: 5 } }];
      }),
    },
    department: { findMany: jest.fn().mockResolvedValue([{ id: 'dept-1', name: 'General Medicine' }]) },
    labReport: { count: jest.fn().mockResolvedValue(9) },
    labResult: { count: jest.fn().mockResolvedValue(2) },
    service: { findMany: jest.fn().mockResolvedValue([{ id: 'svc-1', name: 'Blood Test', code: 'LAB-BT' }]) },
    medicineBatch: {
      count: jest.fn().mockImplementation(async ({ where }: any) => {
        if (where?.currentStock === 0) return 1;
        if (where?.stockStatus === 'EXPIRED') return 0;
        if (where?.stockStatus?.in) return 3;
        return 2;
      }),
    },
    purchaseRequisition: { count: jest.fn().mockResolvedValue(4) },
    purchaseOrder: { count: jest.fn().mockResolvedValue(1) },
  };

  beforeAll(async () => {
    const adminHash = await bcrypt.hash('AdminPass123!', 10);
    const nurseHash = await bcrypt.hash('NursePass123!', 10);
    usersStore.push(
      { id: 'u-admin', identifier: 'admin@esic.gov.in', passwordHash: adminHash, roleId: 'r-admin', active: true },
      { id: 'u-nurse', identifier: 'nurse@esic.gov.in', passwordHash: nurseHash, roleId: 'r-nurse', active: true },
    );

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [
        { identifier: 'admin@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
        { identifier: 'nurse@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
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

    adminToken = (
      await request(app.getHttpServer()).post('/api/auth/login').send({ identifier: 'admin@esic.gov.in', password: 'AdminPass123!' }).expect(200)
    ).body.accessToken;
    nurseToken = (
      await request(app.getHttpServer()).post('/api/auth/login').send({ identifier: 'nurse@esic.gov.in', password: 'NursePass123!' }).expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/analytics/operations returns real aggregate counts, not placeholders', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/analytics/operations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.registrations).toBe(12);
    expect(res.body.opd.totalVisits).toBe(30);
    expect(res.body.opd.byDepartment).toEqual([{ department: 'General Medicine', count: 7 }]);
    expect(res.body.ipd).toEqual({ admissions: 5, discharges: 2, totalBeds: 10, occupiedBeds: 3, occupancyRate: 30 });
    expect(res.body.laboratory.totalOrders).toBe(20);
    expect(res.body.therapy.sessionsPerformed).toBe(6);
  });

  it('GET /api/analytics/clinical computes average turnaround from the raw query', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/analytics/clinical')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.laboratory.totalOrders).toBe(20);
    expect(res.body.laboratory.pendingVerification).toBe(4);
    expect(res.body.laboratory.averageTurnaroundHours).toBe(18.5);
    expect(res.body.laboratory.abnormalResultCount).toBe(2);
  });

  it('GET /api/analytics/financial resolves service names for the top-revenue list', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/analytics/financial')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.totalAmount).toBe('5000');
    expect(res.body.paidAmount).toBe('3000');
    expect(res.body.outstandingAmount).toBe('2000');
    expect(res.body.topServicesByRevenue).toEqual([
      { service: 'Blood Test', code: 'LAB-BT', amount: '1000', count: 5 },
    ]);
  });

  it('GET /api/analytics/inventory returns stock and procurement alert counts', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/analytics/inventory')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.outOfStockBatches).toBe(1);
    expect(res.body.expiredBatches).toBe(0);
    expect(res.body.procurement).toEqual({ pendingRequisitions: 4, openPurchaseOrders: 1 });
  });

  it.each(['operations', 'clinical', 'financial', 'inventory'])(
    'GET /api/analytics/%s rejects a role without Analytics:read with 403',
    async (endpoint) => {
      await request(app.getHttpServer())
        .get(`/api/analytics/${endpoint}`)
        .set('Authorization', `Bearer ${nurseToken}`)
        .expect(403);
    },
  );

  it('rejects every analytics endpoint with no token at all', async () => {
    await request(app.getHttpServer()).get('/api/analytics/operations').expect(401);
  });
});
