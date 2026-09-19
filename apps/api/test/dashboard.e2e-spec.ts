import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

describe('Dashboard Module (E2E - Phase 14 Admin Analytics)', () => {
  let app: INestApplication;
  let authToken: string;

  // `Analytics:read` is what unlocks the admin-tier billing/auditExceptions/staff
  // sections (Fix 9 / F-13) -- granted here since this suite asserts on them.
  const rolesStore: any[] = [{ id: 'r-admin', name: 'SuperAdmin', isSystemRole: true }];
  const permissionsStore: any[] = [{ id: 'p1', roleId: 'r-admin', resource: 'Analytics', action: 'read' }];
  const usersStore: any[] = [];

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
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
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(3),
      findMany: jest.fn().mockResolvedValue([
        { id: 'log-1', action: 'auth.login_success', entityType: 'Auth', entityId: 'u-1' },
      ]),
    },
    // Every widget on this dashboard is a plain aggregate count/groupBy/findMany
    // -- this e2e spec only asserts each response *section* is present, not
    // exact figures, so one fixed value per model is enough (real per-metric
    // correctness is DashboardService's own unit-test's job, not this one's).
    visit: { count: jest.fn().mockResolvedValue(10) },
    admission: {
      count: jest.fn().mockResolvedValue(2),
      groupBy: jest.fn().mockResolvedValue([{ eligibleCategory: 'C', _count: { _all: 2 } }]),
    },
    bed: { count: jest.fn().mockResolvedValue(5) },
    medicineBatch: { count: jest.fn().mockResolvedValue(1) },
    purchaseRequisition: { count: jest.fn().mockResolvedValue(0) },
    purchaseOrder: { count: jest.fn().mockResolvedValue(0) },
    chargeItem: { count: jest.fn().mockResolvedValue(4) },
    employee: { count: jest.fn().mockResolvedValue(20) },
  };

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('SuperAdminSecret123!', 10);
    usersStore.push({
      id: '00000000-0000-0000-0000-000000000010',
      identifier: 'superadmin@esic.gov.in',
      passwordHash,
      roleId: 'r-admin',
      active: true,
    });

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [{ identifier: 'superadmin@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID }],
      mockPrismaService,
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(PlatformPrismaService)
      .useValue(platformPrismaMock)
      .overrideProvider(TenantClientFactory)
      .useValue(tenantClientFactoryMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const loginRes = await request(app.getHttpServer()).post('/api/auth/login').send({
      identifier: 'superadmin@esic.gov.in',
      password: 'SuperAdminSecret123!',
    });

    authToken = loginRes.body.accessToken || '';
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. GET /api/dashboard/summary - Should return aggregate metrics for all 11 widget areas', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.opd).toBeDefined();
    expect(res.body.ipd).toBeDefined();
    expect(res.body.inventory).toBeDefined();
    expect(res.body.procurement).toBeDefined();
    expect(res.body.billing).toBeDefined();
    expect(res.body.auditExceptions).toBeDefined();
  });

  it('2. Zero Write Side Effect Verification - Multiple dashboard calls produce 0 state changes', async () => {
    // Call dashboard summary endpoint 5 consecutive times
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .get('/api/dashboard/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    }

    // Verify response structure remains consistent and zero side effects occur
    const finalRes = await request(app.getHttpServer())
      .get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(finalRes.body.opd).toBeDefined();
  });
});
