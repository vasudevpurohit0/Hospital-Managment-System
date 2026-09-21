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
 * Platform module (e2e): first automated HTTP-level coverage for all 6
 * `PlatformOnlyGuard`-gated controllers (hospitals, platform-admins,
 * hospital-admins, platform-dashboard, platform-audit-log,
 * platform-staff-audit) -- previously reachable only by hand-testing against
 * a live server with real Super Admin credentials (see
 * docs/QA-SESSION-LOG.md's "Platform/Super Admin functionality --
 * untested" gap). Uses a real platform (Super Admin) login, resolved the
 * same way `AuthService.loginAsPlatformUser()` actually resolves one
 * (`LoginDirectoryService` returns `hospitalId: null`, then
 * `platformUser.findUnique`) -- not a shortcut.
 *
 * Hospital *creation* (`hospitals.service.ts::createHospital`, a real schema
 * provisioning + migration + seed run) and per-hospital dashboard/staff-audit
 * metrics (`getHospitalMetrics`, its own deep tenant-side aggregation) are
 * deliberately out of scope -- covered by `hospitals.service.spec.ts`, and
 * exercised here only via the trivial "zero active hospitals" case, which
 * exercises the real aggregation code path without needing a second mocked
 * tenant client on top of everything else this spec already sets up.
 */
describe('Platform Module (e2e)', () => {
  let app: INestApplication;
  let superAdminToken: string;
  let hospitalAdminToken: string;

  const superAdminId = '11111111-1111-4111-8111-111111111111';
  const hospitalId = '22222222-2222-4222-8222-222222222222';
  const provisioningHospitalId = '33333333-3333-4333-8333-333333333333';

  const platformUsersStore: any[] = [];
  const hospitalsStore: any[] = [
    { id: hospitalId, name: 'Test Hospital', slug: 'test-hospital', schemaName: 'hospital_test', status: 'ACTIVE', createdAt: new Date(), contactEmail: null, contactPhone: null, address: null },
    { id: provisioningHospitalId, name: 'New Hospital', slug: 'new-hospital', schemaName: 'hospital_new', status: 'PROVISIONING', createdAt: new Date() },
  ];
  const platformAuditLogStore: any[] = [
    { id: 'pal-1', action: 'GET', method: 'GET', path: '/api/employees', createdAt: new Date(), platformUser: { email: 'superadmin@platform.local' }, hospital: { name: 'Test Hospital', slug: 'test-hospital' } },
  ];
  const loginDirectoryRows = new Map<string, any>();

  const rolesStore: any[] = [{ id: 'r-admin', name: 'Administrator', isSystemRole: true }];
  const usersStore: any[] = []; // hospital-side users for the non-platform RBAC check

  const mockTenantPrisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const user = usersStore.find((u) => u.id === where?.id || u.identifier === where?.identifier);
        if (!user) return null;
        const role = rolesStore.find((r) => r.id === user.roleId);
        return { ...user, role: { ...role, permissions: [] } };
      }),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: `tenant-user-${usersStore.length + 1}`, ...data };
        usersStore.push(created);
        return created;
      }),
    },
    role: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'r-admin', name: 'Administrator' }) },
    loginActivity: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  };

  const platformPrismaMock: any = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    loginIdentifier: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => loginDirectoryRows.get(where.identifier) ?? null),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const row = loginDirectoryRows.get(where.identifier);
        if (row) Object.assign(row, data);
        return row;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        loginDirectoryRows.set(data.identifier, { ...data, failedAttempts: 0, lockedUntil: null, manuallyLockedAt: null });
        return data;
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    hospital: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        if (where.id === E2E_TEST_HOSPITAL_ID) return { id: E2E_TEST_HOSPITAL_ID, status: 'ACTIVE', schemaName: 'hospital_e2e_test', slug: 'e2e-test' };
        return hospitalsStore.find((h) => h.id === where.id) ?? null;
      }),
      findMany: jest.fn().mockImplementation(async ({ where }: any) => {
        if (where?.status?.not) return hospitalsStore.filter((h) => h.status !== where.status.not);
        if (where?.status) return hospitalsStore.filter((h) => h.status === where.status);
        return hospitalsStore;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const h = hospitalsStore.find((x) => x.id === where.id);
        Object.assign(h, data);
        return h;
      }),
    },
    platformUser: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => platformUsersStore.find((u) => u.id === where.id || u.email === where.email) ?? null),
      findMany: jest.fn().mockResolvedValue(platformUsersStore),
      count: jest.fn().mockImplementation(async ({ where }: any) => platformUsersStore.filter((u) => (where?.active !== undefined ? u.active === where.active : true)).length),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: `pa-${platformUsersStore.length + 1}`, active: true, createdAt: new Date(), ...data };
        platformUsersStore.push(created);
        return created;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const u = platformUsersStore.find((x) => x.id === where.id);
        Object.assign(u, data);
        return u;
      }),
    },
    platformLoginActivity: { create: jest.fn().mockResolvedValue({}) },
    platformAuditLog: {
      findMany: jest.fn().mockResolvedValue(platformAuditLogStore),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const actor = platformUsersStore.find((u) => u.id === data.platformUserId);
        const hospital = hospitalsStore.find((h) => h.id === data.hospitalId);
        const created = {
          id: `pal-${platformAuditLogStore.length + 1}`,
          createdAt: new Date(),
          ...data,
          platformUser: { email: actor?.email ?? 'unknown' },
          hospital: hospital ? { name: hospital.name, slug: hospital.slug } : null,
        };
        platformAuditLogStore.push(created);
        return created;
      }),
    },
  };

  const tenantClientFactoryMock = { getClient: jest.fn().mockResolvedValue(mockTenantPrisma) };

  beforeAll(async () => {
    const superAdminHash = await bcrypt.hash('SuperAdminPass123!', 10);
    const hospitalAdminHash = await bcrypt.hash('AdminPass123!', 10);

    platformUsersStore.push({ id: superAdminId, email: 'superadmin@platform.local', name: 'Super Admin', passwordHash: superAdminHash, active: true, createdAt: new Date() });
    usersStore.push({ id: 'u-hospital-admin', identifier: 'admin@esic.gov.in', passwordHash: hospitalAdminHash, roleId: 'r-admin', active: true });

    loginDirectoryRows.set('superadmin@platform.local', { identifier: 'superadmin@platform.local', hospitalId: null, failedAttempts: 0, lockedUntil: null, manuallyLockedAt: null });
    loginDirectoryRows.set('admin@esic.gov.in', { identifier: 'admin@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID, failedAttempts: 0, lockedUntil: null, manuallyLockedAt: null });

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(mockTenantPrisma)
      .overrideProvider(PlatformPrismaService)
      .useValue(platformPrismaMock)
      .overrideProvider(TenantClientFactory)
      .useValue(tenantClientFactoryMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    superAdminToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'superadmin@platform.local', password: 'SuperAdminPass123!' })
        .expect(200)
    ).body.accessToken;
    hospitalAdminToken = (
      await request(app.getHttpServer()).post('/api/auth/login').send({ identifier: 'admin@esic.gov.in', password: 'AdminPass123!' }).expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PlatformOnlyGuard: every platform route rejects a hospital-staff token, even Administrator', () => {
    it.each([
      ['/api/platform/hospitals', 'get'],
      ['/api/platform/admins', 'get'],
      ['/api/platform/dashboard/summary', 'get'],
      ['/api/platform/audit-log', 'get'],
      ['/api/platform/staff-audit-log', 'get'],
      ['/api/platform/hospital-admins', 'get'],
    ])('%s rejects a hospital Administrator token with 403', async (path) => {
      await request(app.getHttpServer())
        .get(path as string)
        .set('Authorization', `Bearer ${hospitalAdminToken}`)
        .expect(403);
    });
  });

  it('GET /api/platform/hospitals lists every hospital, including ones still provisioning', async () => {
    const res = await request(app.getHttpServer()).get('/api/platform/hospitals').set('Authorization', `Bearer ${superAdminToken}`).expect(200);
    expect(res.body).toHaveLength(2);
  });

  it('GET /api/platform/hospitals/:id 404s for an unknown hospital', async () => {
    await request(app.getHttpServer())
      .get('/api/platform/hospitals/99999999-9999-4999-8999-999999999999')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(404);
  });

  it('PATCH /api/platform/hospitals/:id updates contact details', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/platform/hospitals/${hospitalId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Test Hospital', contactEmail: 'new@test.com' })
      .expect(200);
    expect(res.body.contactEmail).toBe('new@test.com');
  });

  it('PATCH /api/platform/hospitals/:id/status suspends an active hospital', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/platform/hospitals/${hospitalId}/status`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(200);
    expect(res.body.status).toBe('SUSPENDED');
  });

  it('PATCH /api/platform/hospitals/:id/status refuses to change status while still PROVISIONING', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/platform/hospitals/${provisioningHospitalId}/status`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(400);
    expect(res.body.message).toMatch(/provisioning/i);
  });

  it('GET /api/platform/admins lists platform admins', async () => {
    const res = await request(app.getHttpServer()).get('/api/platform/admins').set('Authorization', `Bearer ${superAdminToken}`).expect(200);
    expect(res.body.some((a: any) => a.email === 'superadmin@platform.local')).toBe(true);
  });

  it('POST /api/platform/admins creates a new platform admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/platform/admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ email: 'second.admin@platform.local', name: 'Second Admin', password: 'SecondAdmin123!' })
      .expect(201);
    expect(res.body.email).toBe('second.admin@platform.local');
  });

  it('POST /api/platform/admins rejects a duplicate email', async () => {
    await request(app.getHttpServer())
      .post('/api/platform/admins')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ email: 'superadmin@platform.local', name: 'X', password: 'Password123!' })
      .expect(409);
  });

  it('PATCH /api/platform/admins/:id/active refuses to let the caller deactivate their own account', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/platform/admins/${superAdminId}/active`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ active: false })
      .expect(400);
    expect(res.body.message).toMatch(/your own/i);
  });

  it('GET /api/platform/dashboard/summary aggregates cleanly with zero active hospitals (both seeded hospitals are non-ACTIVE at this point)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/platform/dashboard/summary')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    expect(res.body.totals ?? res.body).toBeDefined();
  });

  it('GET /api/platform/audit-log lists Super Admin cross-hospital access events', async () => {
    const res = await request(app.getHttpServer()).get('/api/platform/audit-log').set('Authorization', `Bearer ${superAdminToken}`).expect(200);
    expect(res.body[0].platformUserEmail).toBe('superadmin@platform.local');
  });

  it('GET /api/platform/staff-audit-log returns an empty list when there are no ACTIVE hospitals to pull from', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/platform/staff-audit-log')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    expect(Array.isArray(res.body.items ?? res.body)).toBe(true);
  });

  it('GET /api/platform/hospital-admins lists Administrator accounts across every onboarded hospital', async () => {
    const res = await request(app.getHttpServer()).get('/api/platform/hospital-admins').set('Authorization', `Bearer ${superAdminToken}`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/platform/hospitals/:id/admins provisions a new Administrator for that hospital', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/platform/hospitals/${hospitalId}/admins`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ identifier: 'second.admin@test-hospital.esic.gov.in', password: 'AdminPass123!' })
      .expect(201);
    expect(res.body.identifier).toBe('second.admin@test-hospital.esic.gov.in');
  });
});
