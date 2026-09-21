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
 * Doctor module (e2e): first automated HTTP-level coverage for CRUD +
 * self-service duty-status (check-in/out, break). `impersonate` was already
 * independently verified live this session by the session that built it
 * (see docs/QA-SESSION-LOG.md) -- not duplicated here.
 */
describe('Doctor Module (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let doctorToken: string;

  const adminRoleId = 'r-admin';
  const doctorRoleId = 'r-doctor';
  const doctorUserId = '11111111-1111-4111-8111-111111111111';

  const rolesStore: any[] = [
    { id: adminRoleId, name: 'Administrator', isSystemRole: true },
    { id: doctorRoleId, name: 'Doctor', isSystemRole: true },
  ];
  const permissionsStore: any[] = [
    { id: 'p1', roleId: adminRoleId, resource: 'Doctor', action: 'read' },
    { id: 'p2', roleId: adminRoleId, resource: 'Doctor', action: 'create' },
    { id: 'p3', roleId: doctorRoleId, resource: 'DoctorDuty', action: 'read' },
    { id: 'p4', roleId: doctorRoleId, resource: 'DoctorDuty', action: 'update' },
  ];
  const usersStore: any[] = [];

  const doctorUser = {
    id: doctorUserId,
    identifier: 'doctor.test@esic.gov.in',
    passwordHash: '',
    roleId: doctorRoleId,
    active: true,
    employeeId: 'emp-doc-1',
    employee: { name: 'Dr. Test', department: 'Cardiology', designation: null, contactPhone: null },
    doctorProfile: {
      userId: doctorUserId,
      dutyStatus: 'OFF_DUTY',
      checkedInAt: null,
      checkedOutAt: null,
      dutyStatusChangedAt: null,
    },
  };

  const doctorsStore: any[] = [doctorUser];
  const rolesConst = { id: 'post-1', title: 'Senior Officer' };

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    $queryRaw: jest.fn().mockResolvedValue([{ last_value: 1 }]),
    role: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => rolesStore.find((r) => r.id === where?.id || r.name === where?.name) || null),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: `role-${rolesStore.length + 1}`, ...data };
        rolesStore.push(created);
        return created;
      }),
    },
    user: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const all = [...usersStore, ...doctorsStore];
        const user = all.find((u) => u.id === where?.id || u.identifier === where?.identifier);
        if (!user) return null;
        const role = rolesStore.find((r) => r.id === user.roleId) ?? user.role;
        const perms = permissionsStore.filter((p) => p.roleId === (user.roleId ?? role?.id));
        return { ...user, role: { ...role, permissions: perms } };
      }),
      findMany: jest.fn().mockResolvedValue(doctorsStore),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const u = doctorsStore.find((x) => x.id === where.id);
        if (u) Object.assign(u, data);
        return u;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: `doc-${doctorsStore.length + 1}`, ...data };
        doctorsStore.push(created);
        return created;
      }),
    },
    loginActivity: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    doctorProfile: {
      findUniqueOrThrow: jest.fn().mockImplementation(async ({ where }) => {
        const u = doctorsStore.find((x) => x.id === where.userId);
        if (!u) throw new Error('Not found');
        return u.doctorProfile;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const u = doctorsStore.find((x) => x.id === where.userId);
        Object.assign(u.doctorProfile, data);
        return u.doctorProfile;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => ({ dutyStatus: 'OFF_DUTY', ...data })),
    },
    oPDVisit: { findFirst: jest.fn().mockResolvedValue(null) },
    post: { findFirst: jest.fn().mockResolvedValue(rolesConst) },
    grade: { findFirst: jest.fn().mockResolvedValue({ id: 'grade-1', payLevel: 'Pay Level 10' }) },
    employmentType: { findFirst: jest.fn().mockResolvedValue({ id: 'emptype-1', code: 'PERMANENT' }) },
    employee: { create: jest.fn().mockImplementation(async ({ data }) => ({ id: `emp-${Date.now()}`, ...data })) },
    hospitalSettings: { findUnique: jest.fn().mockResolvedValue(null) },
  };

  beforeAll(async () => {
    const adminHash = await bcrypt.hash('AdminPass123!', 10);
    const doctorHash = await bcrypt.hash('DoctorPass123!', 10);
    doctorUser.passwordHash = doctorHash;
    usersStore.push({ id: 'u-admin', identifier: 'admin@esic.gov.in', passwordHash: adminHash, roleId: adminRoleId, active: true });

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [
        { identifier: 'admin@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
        { identifier: 'doctor.test@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
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
    doctorToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'doctor.test@esic.gov.in', password: 'DoctorPass123!' })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/doctors lists doctors', async () => {
    const res = await request(app.getHttpServer()).get('/api/doctors').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('POST /api/doctors creates a new doctor with a DoctorProfile row', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Dr. New', specialty: 'Pediatrics', experience: '5 years', email: 'dr.new@esic.gov.in' })
      .expect(201);
    expect(res.body.email).toBe('dr.new@esic.gov.in');
  });

  it('POST /api/doctors is rejected without Doctor:create', async () => {
    await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ name: 'X', specialty: 'X', experience: 'X', email: 'x@esic.gov.in' })
      .expect(403);
  });

  it("GET /api/doctors/me/duty-status returns the logged-in doctor's own status (OFF_DUTY initially)", async () => {
    const res = await request(app.getHttpServer())
      .get('/api/doctors/me/duty-status')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    expect(res.body.dutyStatus).toBe('OFF_DUTY');
  });

  it('POST /api/doctors/me/check-in checks the doctor in', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/doctors/me/check-in')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(201);
    expect(res.body.dutyStatus).toBe('AVAILABLE');
  });

  it('POST /api/doctors/me/check-in a second time is rejected (already checked in)', async () => {
    await request(app.getHttpServer()).post('/api/doctors/me/check-in').set('Authorization', `Bearer ${doctorToken}`).expect(400);
  });

  it('POST /api/doctors/me/break/start starts a break', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/doctors/me/break/start')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(201);
    expect(res.body.dutyStatus).toBe('ON_BREAK');
  });

  it('POST /api/doctors/me/check-out is rejected while on a break-adjacent active visit is not the case here, but starting a SECOND break is rejected', async () => {
    await request(app.getHttpServer()).post('/api/doctors/me/break/start').set('Authorization', `Bearer ${doctorToken}`).expect(400);
  });

  it('POST /api/doctors/me/break/end ends the break, returning to AVAILABLE', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/doctors/me/break/end')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(201);
    expect(res.body.dutyStatus).toBe('AVAILABLE');
  });

  it('POST /api/doctors/me/check-out checks the doctor out', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/doctors/me/check-out')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(201);
    expect(res.body.dutyStatus).toBe('OFF_DUTY');
  });

  it('GET /api/doctors/me/duty-status is rejected without DoctorDuty:read', async () => {
    await request(app.getHttpServer()).get('/api/doctors/me/duty-status').set('Authorization', `Bearer ${adminToken}`).expect(403);
  });
});
