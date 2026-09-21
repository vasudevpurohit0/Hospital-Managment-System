import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

describe('Billing Module (E2E - Phase 13 Billing & Benefit Ledger)', () => {
  let app: INestApplication;
  let authToken: string;

  const rolesStore: any[] = [{ id: 'r-admin', name: 'SuperAdmin', isSystemRole: true }];
  const permissionsStore: any[] = [{ id: 'p1', roleId: 'r-admin', resource: 'Billing', action: 'read' }];
  const usersStore: any[] = [];

  const chargeItem = {
    id: '44444444-4444-4444-8444-444444444444',
    prescriptionItemId: 'item-e2e-1',
    description: 'Paracetamol',
    categoryName: 'Pharmacy',
    quantity: { toString: () => '2' },
    unitRate: { toString: () => '15.00' },
    grossAmount: { toString: () => '30.00' },
    discountAmount: { toString: () => '0.00' },
    netAmount: { toString: () => '30.00' },
    benefitOutcome: 'PAID',
    status: 'PAID',
    createdAt: new Date(),
    prescriptionItem: { id: 'item-e2e-1', dose: '500mg', frequency: '1-0-1', duration: '5 days' },
    visit: {
      employee: {
        name: 'Anil Gupta',
        employeeId: 'EMP-555',
        employmentType: { name: 'Permanent Employee' },
        patientProfile: {},
      },
    },
    receipt: { id: 'receipt-e2e-1', receiptNumber: 'RCPT/2026/000001' },
  };

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
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    chargeItem: {
      findMany: jest.fn().mockResolvedValue([chargeItem]),
      findUnique: jest.fn().mockImplementation(async ({ where }) => (where.id === chargeItem.id ? chargeItem : null)),
    },
    brandingConfig: {
      findUnique: jest.fn().mockResolvedValue({ id: 'singleton', hospitalName: 'ESIC Model Hospital & ODC' }),
    },
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

  it('1. GET /api/billing/transactions - Should return billing transactions ledger', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/billing/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].id).toBe(chargeItem.id);
  });

  it('2. GET /api/billing/receipts/:id - Should return formatted receipt summary data', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/billing/receipts/${chargeItem.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.transactionId).toBeDefined();
    expect(res.body.receiptReference).toBeDefined();
    expect(res.body.status).toBe('PAID & ISSUED');
  });
});
