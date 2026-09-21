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
 * Patient module (e2e): first automated HTTP-level coverage for
 * verify/register/lookup/search/visit-creation/profile-update. Uses the
 * app's own `MockLabourDeptClient` unmodified (a real, deterministic,
 * database-free provider -- any `EMP-*`/`ESIC-*` id it's given resolves to a
 * verified record; anything else returns unverified), rather than mocking
 * yet another layer. `getPatientMedicalHistory`/`getPatientMasterRecord`/
 * `getPatientTimeline` are deliberately out of scope here -- deep, already
 * covered by `patient-history.service.spec.ts`.
 */
describe('Patient Module (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let pharmacistToken: string;

  const rolesStore: any[] = [
    { id: 'r-admin', name: 'Administrator', isSystemRole: true },
    { id: 'r-pharmacist', name: 'Pharmacist', isSystemRole: true },
  ];
  const permissionsStore: any[] = [
    { id: 'p1', roleId: 'r-admin', resource: 'Employee', action: 'read' },
    { id: 'p2', roleId: 'r-admin', resource: 'Employee', action: 'create' },
    { id: 'p3', roleId: 'r-admin', resource: 'Employee', action: 'update' },
    { id: 'p4', roleId: 'r-admin', resource: 'HospitalUID', action: 'read' },
    { id: 'p5', roleId: 'r-admin', resource: 'Visit', action: 'create' },
  ];
  const usersStore: any[] = [];

  const employeesStore: any[] = [];
  const hospitalUidsStore: any[] = [];
  const postsStore: any[] = [];
  const gradesStore: any[] = [];
  const employmentTypesStore: any[] = [];

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
    employee: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => employeesStore.find((e) => e.employeeId === where.employeeId || e.id === where.id) ?? null),
      findFirst: jest.fn().mockImplementation(async ({ where }) =>
        employeesStore.find((e) => where.OR.some((c: any) => e.employeeId === c.employeeId?.equals || e.id === c.id)) ?? null,
      ),
      findMany: jest.fn().mockResolvedValue(employeesStore),
      count: jest.fn().mockResolvedValue(employeesStore.length),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: `emp-${employeesStore.length + 1}`, visits: [], ...data };
        employeesStore.push(created);
        return created;
      }),
    },
    manualVerificationCase: {
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'case-1', ...data })),
    },
    post: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => postsStore.find((p) => p.title === where.title) ?? null),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: `post-${postsStore.length + 1}`, ...data };
        postsStore.push(created);
        return created;
      }),
    },
    grade: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => gradesStore.find((g) => g.payLevel === where.payLevel) ?? null),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: `grade-${gradesStore.length + 1}`, ...data };
        gradesStore.push(created);
        return created;
      }),
    },
    employmentType: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => employmentTypesStore.find((e) => e.code === where.code) ?? null),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: `emptype-${employmentTypesStore.length + 1}`, ...data };
        employmentTypesStore.push(created);
        return created;
      }),
    },
    patientProfile: {
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'profile-1', ...data })),
    },
    hospitalUID: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        const code = where?.OR?.find((c: any) => c.uidCode)?.uidCode ?? where?.uidCode?.startsWith;
        return hospitalUidsStore.find((u) => u.uidCode === code) ?? null;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { ...data };
        hospitalUidsStore.push(created);
        const emp = employeesStore.find((e) => e.id === data.employeeId);
        if (emp) emp.hospitalUid = created;
        return created;
      }),
    },
    visit: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'visit-1', ...data })),
    },
  };

  beforeAll(async () => {
    const adminHash = await bcrypt.hash('AdminPass123!', 10);
    const pharmacistHash = await bcrypt.hash('PharmacistPass123!', 10);
    usersStore.push(
      { id: 'u-admin', identifier: 'admin@esic.gov.in', passwordHash: adminHash, roleId: 'r-admin', active: true },
      { id: 'u-pharmacist', identifier: 'pharmacist@esic.gov.in', passwordHash: pharmacistHash, roleId: 'r-pharmacist', active: true },
    );

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [
        { identifier: 'admin@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
        { identifier: 'pharmacist@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
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
    pharmacistToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'pharmacist@esic.gov.in', password: 'PharmacistPass123!' })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/patients/verify-employee returns UNVERIFIED for an unknown id', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/patients/verify-employee')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: 'NOT-A-REAL-ID' })
      .expect(200);
    expect(res.body.status).toBe('UNVERIFIED');
  });

  it('POST /api/patients/verify-employee returns VERIFIED for a real Labour Dept id, not yet registered', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/patients/verify-employee')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: 'EMP-1001' })
      .expect(200);
    expect(res.body.status).toBe('VERIFIED');
    expect(res.body.verifiedData.name).toBe('Rajesh Kumar');
    expect(res.body.existingPatient).toBeNull();
  });

  it('POST /api/patients/verify-employee is rejected without Employee:read', async () => {
    await request(app.getHttpServer())
      .post('/api/patients/verify-employee')
      .set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ employeeId: 'EMP-1001' })
      .expect(403);
  });

  it('POST /api/patients/register registers a new patient with a fresh Hospital UID', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/patients/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: 'EMP-1001' })
      .expect(201);

    expect(res.body.status).toBe('REGISTERED');
    expect(res.body.employee.employeeId).toBe('EMP-1001');
    expect(res.body.hospitalUid.uidCode).toMatch(/^ESIC-\d{4}-/);
  });

  it('POST /api/patients/register rejects a duplicate registration for an already-registered employee', async () => {
    await request(app.getHttpServer())
      .post('/api/patients/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: 'EMP-1001' })
      .expect(409);
  });

  it('POST /api/patients/register escalates to manual verification for an id the Labour Dept mock rejects', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/patients/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: 'totally-unknown-format' })
      .expect(201);
    expect(res.body.status).toBe('MANUAL_VERIFICATION_PENDING');
  });

  it('GET /api/patients/employee/:employeeId looks up the newly-registered patient', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/patients/employee/EMP-1001')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.employeeId).toBe('EMP-1001');
  });

  it('POST /api/patients/visit opens a Direct (non-OPD-token) visit for therapy entry', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/patients/visit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: 'EMP-1001', type: 'OPD', visitPurpose: 'THERAPY' })
      .expect(201);
    expect(res.body.status).toBe('CREATED');
    expect(res.body.visit.status).toBe('OPEN');
    expect(res.body.visitPurpose).toBe('THERAPY');
    expect(res.body.opdVisit).toBeNull(); // Direct-therapy: no OPD token/queue entry
  });

  it('POST /api/patients/visit 404s for an employee that does not exist', async () => {
    await request(app.getHttpServer())
      .post('/api/patients/visit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: 'NOBODY-HERE', type: 'OPD', visitPurpose: 'THERAPY' })
      .expect(404);
  });

  it('POST /api/patients/visit is rejected without Visit:create', async () => {
    await request(app.getHttpServer())
      .post('/api/patients/visit')
      .set('Authorization', `Bearer ${pharmacistToken}`)
      .send({ employeeId: 'EMP-1001', type: 'OPD', visitPurpose: 'THERAPY' })
      .expect(403);
  });
});
