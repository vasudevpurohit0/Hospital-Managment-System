import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

describe('InventoryModule (e2e)', () => {
  let app: INestApplication;
  let jwtToken: string;

  const rolesStore: any[] = [{ id: 'r-admin', name: 'SuperAdmin', isSystemRole: true }];
  const permissionsStore: any[] = [
    { id: 'p1', roleId: 'r-admin', resource: 'MedicineBatch', action: 'read' },
    { id: 'p2', roleId: 'r-admin', resource: 'Medicine', action: 'create' },
  ];
  const usersStore: any[] = [];

  const medicinesStore: any[] = [
    {
      id: 'med-1',
      genericName: 'Amoxicillin',
      brandName: 'Novamox',
      category: 'Antibiotics',
      strength: '500mg',
      dosageForm: 'Capsule',
      batches: [
        {
          id: 'batch-1',
          currentStock: 100,
          reorderLevel: 20,
          expiryDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          stockStatus: 'IN_STOCK',
          supplier: null,
        },
      ],
    },
  ];

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
    medicine: {
      findMany: jest.fn().mockResolvedValue(medicinesStore),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: `med-${Date.now()}`, batches: [], ...data };
        medicinesStore.push(created);
        return created;
      }),
    },
    purchaseRequisition: { findMany: jest.fn().mockResolvedValue([]) },
    medicineBatch: {
      // getLowStockAlerts() first asks the database (via $queryRaw) which
      // ids are low, then re-fetches just those via findMany -- nothing is
      // below its reorder level in this fixture, so both stay empty.
      findMany: jest.fn().mockResolvedValue([]),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    // Login as SuperAdmin / StoreManager
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'superadmin@esic.gov.in', password: 'SuperAdminSecret123!' });

    jwtToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/inventory/medicines returns medicine master catalog with stock status', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/inventory/medicines')
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // Verify stockStatus matches stored DB enum
    const firstMed = res.body[0];
    expect(firstMed).toHaveProperty('genericName');
    if (firstMed.batches && firstMed.batches.length > 0) {
      expect(firstMed.batches[0]).toHaveProperty('stockStatus');
      expect([
        'IN_STOCK',
        'EARLY_WARNING',
        'CRITICAL_ALERT',
        'EXPIRED',
        'QUARANTINED',
        'DISPOSED',
      ]).toContain(firstMed.batches[0].stockStatus);
    }
  });

  it('POST /api/inventory/medicines registers a new medicine master entry', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/inventory/medicines')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({
        genericName: `Amoxicillin-${Date.now()}`,
        brandName: 'Mox',
        category: 'Antibiotics',
        strength: '250mg',
        dosageForm: 'Capsule',
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.category).toBe('Antibiotics');
  });

  it('GET /api/inventory/low-stock returns reorder alerts', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/inventory/low-stock')
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});
