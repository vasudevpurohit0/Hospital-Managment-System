import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

/** Catalog/Pricing module (e2e): first automated HTTP-level coverage. */
describe('Catalog & Pricing Module (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let receptionToken: string;

  const rolesStore: any[] = [
    { id: 'r-admin', name: 'Administrator', isSystemRole: true },
    { id: 'r-reception', name: 'Reception', isSystemRole: true },
  ];
  const permissionsStore: any[] = [
    { id: 'p1', roleId: 'r-admin', resource: 'Service', action: 'read' },
    { id: 'p2', roleId: 'r-admin', resource: 'Service', action: 'create' },
    { id: 'p3', roleId: 'r-admin', resource: 'ServicePrice', action: 'create' },
    { id: 'p4', roleId: 'r-admin', resource: 'ServicePrice', action: 'read' },
    { id: 'p5', roleId: 'r-reception', resource: 'Service', action: 'read' },
  ];
  const usersStore: any[] = [];

  const category = { id: '11111111-1111-4111-8111-111111111111', code: 'CONSULT', name: 'Consultation', sortOrder: 1, active: true };
  const pricedService = {
    id: '22222222-2222-4222-8222-222222222222',
    code: 'CONSULT-GEN',
    name: 'OPD Consultation',
    categoryId: '11111111-1111-4111-8111-111111111111',
    category,
    serviceType: 'CONSULTATION',
    applicability: 'OPD',
    active: true,
  };
  const unpricedService = {
    id: '33333333-3333-4333-8333-333333333333',
    code: 'NADI-01',
    name: 'Nadi Pariksha',
    categoryId: '11111111-1111-4111-8111-111111111111',
    category,
    serviceType: 'PROCEDURE',
    applicability: 'BOTH',
    active: true,
  };
  const servicesStore = [pricedService, unpricedService];
  const pricesStore: any[] = [
    { id: 'price-1', serviceId: '22222222-2222-4222-8222-222222222222', amount: 500, effectiveFrom: new Date('2026-01-01'), effectiveTo: null },
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
    auditLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    serviceCategory: {
      findMany: jest.fn().mockResolvedValue([{ ...category, _count: { services: 2 } }]),
      findUnique: jest.fn().mockImplementation(async ({ where }) => (where.id === category.id ? category : null)),
    },
    service: {
      count: jest.fn().mockResolvedValue(servicesStore.length),
      findMany: jest.fn().mockImplementation(async () =>
        servicesStore.map((s) => ({
          ...s,
          prices: pricesStore.filter((p) => p.serviceId === s.id),
          _count: { packageItems: 0 },
        })),
      ),
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const found = where.id ? servicesStore.find((s) => s.id === where.id) : servicesStore.find((s) => s.code === where.code);
        if (!found) return null;
        return { ...found, prices: pricesStore.filter((p) => p.serviceId === found.id), packageItems: [] };
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: `svc-${Date.now()}`, category, prices: [], packageItems: [], _count: { packageItems: 0 }, ...data };
        servicesStore.push(created);
        return created;
      }),
    },
    servicePrice: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        if (where?.effectiveTo === null) {
          return pricesStore.find((p) => p.serviceId === where.serviceId && p.effectiveTo === null) ?? null;
        }
        return (
          pricesStore.find(
            (p) => p.serviceId === where.serviceId && p.effectiveFrom <= (where.effectiveFrom?.lte ?? new Date()),
          ) ?? null
        );
      }),
      findMany: jest.fn().mockImplementation(async ({ where }) => pricesStore.filter((p) => p.serviceId === where?.serviceId)),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const p = pricesStore.find((x) => x.id === where.id);
        Object.assign(p, data);
        return p;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: `price-${Date.now()}`, ...data };
        pricesStore.push(created);
        return created;
      }),
    },
  };

  beforeAll(async () => {
    const adminHash = await bcrypt.hash('AdminPass123!', 10);
    const receptionHash = await bcrypt.hash('ReceptionPass123!', 10);
    usersStore.push(
      { id: 'u-admin', identifier: 'admin@esic.gov.in', passwordHash: adminHash, roleId: 'r-admin', active: true },
      { id: 'u-reception', identifier: 'reception@esic.gov.in', passwordHash: receptionHash, roleId: 'r-reception', active: true },
    );

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [
        { identifier: 'admin@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
        { identifier: 'reception@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
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
    receptionToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'reception@esic.gov.in', password: 'ReceptionPass123!' })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/catalog/categories lists categories with a service count', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/catalog/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toEqual([{ id: '11111111-1111-4111-8111-111111111111', code: 'CONSULT', name: 'Consultation', sortOrder: 1, active: true, serviceCount: 2 }]);
  });

  it('GET /api/catalog/services lists services, readable by a non-admin role too (Service:read)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/catalog/services')
      .set('Authorization', `Bearer ${receptionToken}`)
      .expect(200);

    expect(res.body.items ?? res.body).toHaveLength(2);
  });

  it('GET /api/catalog/services/:id/price resolves the currently effective rate', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/catalog/services/22222222-2222-4222-8222-222222222222/price')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.amount).toBe('500');
    expect(res.body.serviceId).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('GET /api/catalog/services/:id/price fails clearly for a service with no rate set (not a silent zero)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/catalog/services/33333333-3333-4333-8333-333333333333/price')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.message).toMatch(/no effective price/i);
  });

  it('POST /api/catalog/services creates a new service (Administrator only)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/catalog/services')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'NEW-SVC', name: 'New Test Service', categoryId: '11111111-1111-4111-8111-111111111111', serviceType: 'PROCEDURE' })
      .expect(201);

    expect(res.body.code).toBe('NEW-SVC');
  });

  it('POST /api/catalog/services is rejected for Reception (lacks Service:create)', async () => {
    await request(app.getHttpServer())
      .post('/api/catalog/services')
      .set('Authorization', `Bearer ${receptionToken}`)
      .send({ code: 'X', name: 'X', categoryId: '11111111-1111-4111-8111-111111111111', serviceType: 'PROCEDURE' })
      .expect(403);
  });

  it('POST /api/catalog/services/:id/prices rejects a negative amount', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/catalog/services/33333333-3333-4333-8333-333333333333/prices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: -10, reason: 'Testing' })
      .expect(400);

    expect(JSON.stringify(res.body.message)).toMatch(/less than 0|negative/i);
  });

  it('POST /api/catalog/services/:id/prices sets a new rate with a reason', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/catalog/services/33333333-3333-4333-8333-333333333333/prices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 250, reason: 'Go-live pricing' })
      .expect(201);

    expect(res.body.current.amount).toBe('250');
  });

  it('POST /api/catalog/services/:id/prices is rejected for Reception (lacks ServicePrice:create)', async () => {
    await request(app.getHttpServer())
      .post('/api/catalog/services/22222222-2222-4222-8222-222222222222/prices')
      .set('Authorization', `Bearer ${receptionToken}`)
      .send({ amount: 100, reason: 'x' })
      .expect(403);
  });
});
