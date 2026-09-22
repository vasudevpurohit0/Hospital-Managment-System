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
 * Regression coverage for a real bug found live-testing the new httpOnly-
 * cookie auth flow (see auth-cookies.util.ts): TenantResolutionMiddleware
 * only ever read the Authorization header, so a cookie-only request reached
 * JwtStrategy.validate() with no tenant context ever set, throwing "No
 * tenant context set" as a 500 -- neither the rest of this e2e suite (every
 * other spec here uses the header exclusively) nor the mocked-Prisma unit
 * suite (which never exercises this middleware) could have caught it.
 */
describe('Cookie-based authentication (e2e)', () => {
  let app: INestApplication;

  const adminRoleId = 'r-admin';
  const adminUserId = '11111111-1111-4111-8111-111111111111';

  const rolesStore: any[] = [{ id: adminRoleId, name: 'Administrator', isSystemRole: true }];
  const permissionsStore: any[] = [{ id: 'p1', roleId: adminRoleId, resource: 'Employee', action: 'read' }];
  const employeesStore: any[] = [{ id: 'emp-1', name: 'Test Employee' }];

  const adminUser = {
    id: adminUserId,
    identifier: 'admin.cookie.test@esic.gov.in',
    passwordHash: '',
    roleId: adminRoleId,
    active: true,
    mustChangePassword: false,
    tokenVersion: 0,
  };

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    role: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => rolesStore.find((r) => r.id === where?.id) || null),
    },
    user: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const user = [adminUser].find((u) => u.id === where?.id || u.identifier === where?.identifier);
        if (!user) return null;
        const role = rolesStore.find((r) => r.id === user.roleId);
        const perms = permissionsStore.filter((p) => p.roleId === user.roleId);
        return { ...user, role: { ...role, permissions: perms } };
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        if (data.tokenVersion?.increment) adminUser.tokenVersion += data.tokenVersion.increment;
        return { ...adminUser, ...where };
      }),
    },
    employee: {
      findMany: jest.fn().mockResolvedValue(employeesStore),
    },
    loginActivity: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    hospitalSettings: { findUnique: jest.fn().mockResolvedValue(null) },
  };

  beforeAll(async () => {
    adminUser.passwordHash = await bcrypt.hash('AdminCookiePass123!', 10);

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [{ identifier: 'admin.cookie.test@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID }],
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
  });

  afterAll(async () => {
    await app.close();
  });

  function extractCookie(setCookieHeader: string[], name: string): string {
    const raw = setCookieHeader.find((c) => c.startsWith(`${name}=`));
    if (!raw) throw new Error(`Cookie "${name}" not found in Set-Cookie header`);
    return raw.split(';')[0];
  }

  it('login sets an httpOnly access-token cookie (SameSite=Lax outside production -- see auth-cookies.util.ts for why production uses None+Secure instead) and returns a csrfToken', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'admin.cookie.test@esic.gov.in', password: 'AdminCookiePass123!' })
      .expect(200);

    const setCookie = res.headers['set-cookie'] as unknown as string[];
    expect(setCookie).toBeDefined();
    const cookie = setCookie.find((c) => c.startsWith('esic_access_token='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api');
    expect(typeof res.body.csrfToken).toBe('string');
    expect(res.body.csrfToken.length).toBeGreaterThan(0);
  });

  it('a protected route succeeds using ONLY the cookie, with no Authorization header at all', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'admin.cookie.test@esic.gov.in', password: 'AdminCookiePass123!' })
      .expect(200);

    const cookie = extractCookie(loginRes.headers['set-cookie'] as unknown as string[], 'esic_access_token');

    const res = await request(app.getHttpServer()).get('/api/employees').set('Cookie', cookie).expect(200);
    expect(res.body).toEqual(employeesStore);
  });

  it('is rejected with 401 when neither a cookie nor an Authorization header is present', async () => {
    await request(app.getHttpServer()).get('/api/employees').expect(401);
  });

  it('logout clears the cookie (Set-Cookie with an expired date), given a matching X-CSRF-Token', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'admin.cookie.test@esic.gov.in', password: 'AdminCookiePass123!' })
      .expect(200);
    const cookie = extractCookie(loginRes.headers['set-cookie'] as unknown as string[], 'esic_access_token');

    const logoutRes = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', loginRes.body.csrfToken)
      .expect(200);

    const cleared = (logoutRes.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('esic_access_token='),
    );
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/esic_access_token=;/);
  });

  it('a cookie-authenticated mutating request with no X-CSRF-Token is rejected with 403 (double-submit CSRF check, 2026-09-22 audit)', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'admin.cookie.test@esic.gov.in', password: 'AdminCookiePass123!' })
      .expect(200);
    const cookie = extractCookie(loginRes.headers['set-cookie'] as unknown as string[], 'esic_access_token');

    await request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', cookie).expect(403);
  });

  it('the cookie from before logout is rejected afterward (tokenVersion invalidation, defense in depth even if the cookie were replayed)', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'admin.cookie.test@esic.gov.in', password: 'AdminCookiePass123!' })
      .expect(200);
    const cookie = extractCookie(loginRes.headers['set-cookie'] as unknown as string[], 'esic_access_token');

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', loginRes.body.csrfToken)
      .expect(200);
    await request(app.getHttpServer()).get('/api/employees').set('Cookie', cookie).expect(401);
  });
});
