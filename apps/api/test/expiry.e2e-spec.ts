import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

describe('Expiry & FEFO Automation (e2e)', () => {
  let app: INestApplication;
  let jwtToken: string;

  const rolesStore: any[] = [{ id: 'r-admin', name: 'SuperAdmin', isSystemRole: true }];
  const permissionsStore: any[] = [
    { id: 'p1', roleId: 'r-admin', resource: 'MedicineBatch', action: 'read' },
    { id: 'p2', roleId: 'r-admin', resource: 'MedicineBatch', action: 'update' },
  ];
  const usersStore: any[] = [];

  const batchesStore: any[] = [
    {
      id: '22222222-2222-4222-8222-222222222222',
      medicineId: 'med-1',
      batchNumber: 'P500-01',
      currentStock: 40,
      minimumStockLevel: 0,
      reorderLevel: 10,
      expiryDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      stockStatus: 'CRITICAL_ALERT',
    },
  ];

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
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
    medicineBatch: {
      // Backs both ExpiryScannerService.runDailyScan()'s three category
      // scans and InventoryService.getExpiringBatches() -- this suite only
      // asserts on response shape, not exact per-category counts, so one
      // fixed set for every findMany call is enough.
      findMany: jest.fn().mockResolvedValue(batchesStore),
      findUnique: jest.fn().mockImplementation(async ({ where }) => batchesStore.find((b) => b.id === where?.id) || null),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const b = batchesStore.find((item) => item.id === where?.id);
        if (b) Object.assign(b, data);
        return b;
      }),
    },
    stockTransaction: { create: jest.fn().mockResolvedValue({}) },
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

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'superadmin@esic.gov.in', password: 'SuperAdminSecret123!' });

    jwtToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/inventory/scan-expiry triggers daily automated expiry scan', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/inventory/scan-expiry')
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(201);

    expect(res.body).toHaveProperty('quarantinedCount');
    expect(res.body).toHaveProperty('criticalCount');
    expect(res.body).toHaveProperty('earlyCount');
    expect(res.body).toHaveProperty('scannedAt');
  });

  it('GET /api/inventory/expiring?within=90 returns expiring batches', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/inventory/expiring?within=90')
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/inventory/batches/:id/quarantine quarantines a batch', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/inventory/batches/22222222-2222-4222-8222-222222222222/quarantine')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ reason: 'Preemptive quarantine' })
      .expect(201);

    expect(res.body.stockStatus).toBe('QUARANTINED');
  });

  it('POST /api/inventory/batches/:id/dispose executes approved disposal with audit log', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/inventory/batches/22222222-2222-4222-8222-222222222222/dispose')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({
        disposalReason: 'Expired past safe threshold',
        notes: 'Bio-hazard destruction cert #9912',
      })
      .expect(201);

    expect(res.body.stockStatus).toBe('DISPOSED');
    expect(res.body.currentStock).toBe(0);
  });
});
