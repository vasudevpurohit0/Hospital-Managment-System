import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';

/**
 * V-21: dedicated regression coverage for the platform's core multi-tenant
 * guarantee -- a hospital-staff token issued for one hospital's schema must
 * never be able to read another hospital's data, even when it targets a
 * record id that genuinely exists (just in the other schema).
 *
 * Every other mocked e2e spec overrides PrismaService directly with one flat
 * mock object (see test/utils/platform-auth-mock.ts), which sidesteps the
 * real tenant-routing Proxy in prisma.module.ts entirely -- fine for specs
 * that only ever exercise one tenant, but it means none of them actually
 * exercises tenant routing. This spec deliberately leaves PrismaService
 * un-mocked so the real AsyncLocalStorage-backed Proxy runs, and only
 * overrides TenantClientFactory to route each hospital's schema name to its
 * own in-memory store -- the same seam TenantResolutionMiddleware and
 * AuthService use in production.
 */
describe('Cross-tenant isolation (e2e)', () => {
  let app: INestApplication;

  const HOSPITAL_A_ID = '11111111-1111-1111-1111-111111111aaa';
  const HOSPITAL_B_ID = '22222222-2222-2222-2222-222222222bbb';
  const SCHEMA_A = 'hospital_e2e_isolation_a';
  const SCHEMA_B = 'hospital_e2e_isolation_b';
  const IDENTIFIER_A = 'doctor.a@hosp-a.e2e.test';
  const IDENTIFIER_B = 'doctor.b@hosp-b.e2e.test';
  const PASSWORD = 'CrossTenant123!';
  const USER_A_ID = 'aaaaaaaa-0000-0000-0000-0000000000u1';
  const USER_B_ID = 'bbbbbbbb-0000-0000-0000-0000000000u1';
  const EMPLOYEE_A_ID = 'aaaaaaaa-0000-0000-0000-00000000e001';
  const EMPLOYEE_B_ID = 'bbbbbbbb-0000-0000-0000-00000000e001';

  let tokenA: string;
  let tokenB: string;

  /** One hospital's self-contained in-memory tenant store, shaped exactly like the real Prisma models the exercised code paths touch. */
  function buildTenantMock(userId: string, identifier: string, passwordHash: string, employee: Record<string, unknown>) {
    const role = { id: `role-${userId}`, name: 'Doctor', permissions: [{ resource: 'Employee', action: 'read' }] };
    const user = {
      id: userId,
      identifier,
      passwordHash,
      roleId: role.id,
      active: true,
      tokenVersion: 0,
      mustChangePassword: false,
    };

    return {
      user: {
        findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id?: string; identifier?: string } }) => {
          if (where.id !== undefined && where.id !== user.id) return null;
          if (where.identifier !== undefined && where.identifier !== user.identifier) return null;
          return { ...user, role };
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      employee: {
        findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          return where.id === employee.id ? employee : null;
        }),
      },
      loginActivity: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
  }

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const tenantAMock = buildTenantMock(USER_A_ID, IDENTIFIER_A, passwordHash, {
      id: EMPLOYEE_A_ID,
      employeeId: 'EMP-A-001',
      name: 'Employee Belonging To Hospital A',
      post: null,
      grade: null,
      employmentType: null,
      hospitalUid: null,
      patientProfile: null,
    });
    const tenantBMock = buildTenantMock(USER_B_ID, IDENTIFIER_B, passwordHash, {
      id: EMPLOYEE_B_ID,
      employeeId: 'EMP-B-001',
      name: 'Employee Belonging To Hospital B',
      post: null,
      grade: null,
      employmentType: null,
      hospitalUid: null,
      patientProfile: null,
    });

    interface DirectoryRow {
      identifier: string;
      hospitalId: string | null;
      failedAttempts: number;
      lockedUntil: Date | null;
      manuallyLockedAt: Date | null;
      lastAttemptAt: Date | null;
    }

    const directoryRows = new Map<string, DirectoryRow>([
      [IDENTIFIER_A, { identifier: IDENTIFIER_A, hospitalId: HOSPITAL_A_ID, failedAttempts: 0, lockedUntil: null, manuallyLockedAt: null, lastAttemptAt: null }],
      [IDENTIFIER_B, { identifier: IDENTIFIER_B, hospitalId: HOSPITAL_B_ID, failedAttempts: 0, lockedUntil: null, manuallyLockedAt: null, lastAttemptAt: null }],
    ]);

    const platformPrismaMock = {
      loginIdentifier: {
        findUnique: jest.fn().mockImplementation(async ({ where }: { where: { identifier: string } }) => {
          return directoryRows.get(where.identifier) ?? null;
        }),
        update: jest.fn().mockImplementation(async ({ where, data }: { where: { identifier: string }; data: Partial<DirectoryRow> }) => {
          const row = directoryRows.get(where.identifier);
          if (!row) throw new Error(`No mocked directory row for "${where.identifier}"`);
          Object.assign(row, data);
          return row;
        }),
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      hospital: {
        // The one piece of real per-tenant routing logic under test: two
        // distinct hospital ids must resolve to two distinct schema names.
        findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
          if (where.id === HOSPITAL_A_ID) return { id: HOSPITAL_A_ID, status: 'ACTIVE', schemaName: SCHEMA_A, slug: 'hosp-a' };
          if (where.id === HOSPITAL_B_ID) return { id: HOSPITAL_B_ID, status: 'ACTIVE', schemaName: SCHEMA_B, slug: 'hosp-b' };
          return null;
        }),
      },
      platformUser: { findUnique: jest.fn().mockResolvedValue(null) },
      platformLoginActivity: { create: jest.fn().mockResolvedValue({}) },
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    const tenantClientFactoryMock = {
      // The key generalization over test/utils/platform-auth-mock.ts's
      // single-hospital helper: this must actually discriminate by schema
      // name for the isolation guarantee below to mean anything.
      getClient: jest.fn().mockImplementation(async (schemaName: string) => {
        if (schemaName === SCHEMA_A) return tenantAMock;
        if (schemaName === SCHEMA_B) return tenantBMock;
        throw new Error(`Unexpected schema requested in test: "${schemaName}"`);
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Deliberately NOT overriding PrismaService here -- see file header.
      .overrideProvider(PlatformPrismaService)
      .useValue(platformPrismaMock)
      .overrideProvider(TenantClientFactory)
      .useValue(tenantClientFactoryMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const loginA = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: IDENTIFIER_A, password: PASSWORD })
      .expect(200);
    tokenA = loginA.body.accessToken;

    const loginB = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: IDENTIFIER_B, password: PASSWORD })
      .expect(200);
    tokenB = loginB.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("logs in each hospital's staff into their own tenant schema", () => {
    expect(tokenA).toEqual(expect.any(String));
    expect(tokenB).toEqual(expect.any(String));
    expect(tokenA).not.toEqual(tokenB);
  });

  it("lets Hospital A's token read Hospital A's own employee", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/employees/${EMPLOYEE_A_ID}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.id).toBe(EMPLOYEE_A_ID);
    expect(res.body.name).toBe('Employee Belonging To Hospital A');
  });

  it("lets Hospital B's token read Hospital B's own employee", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/employees/${EMPLOYEE_B_ID}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(res.body.id).toBe(EMPLOYEE_B_ID);
    expect(res.body.name).toBe('Employee Belonging To Hospital B');
  });

  it("blocks Hospital A's token from reading Hospital B's employee by id (404, not a cross-tenant leak)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/employees/${EMPLOYEE_B_ID}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);

    expect(JSON.stringify(res.body)).not.toContain('Hospital B');
  });

  it("blocks Hospital B's token from reading Hospital A's employee by id (404, not a cross-tenant leak)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/employees/${EMPLOYEE_A_ID}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    expect(JSON.stringify(res.body)).not.toContain('Hospital A');
  });
});
