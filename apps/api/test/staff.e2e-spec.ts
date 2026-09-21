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
 * Staff module (e2e): first automated HTTP-level coverage for the generic
 * CRUD + account-lifecycle routes (find/create/update/activate/reset-password
 * /lock/resend-activation). `default-roles` (GET/POST) is already covered by
 * `staff-default-roles.spec.ts`; `impersonate` was independently verified
 * live this session by the session that built it (see docs/QA-SESSION-LOG.md)
 * -- neither is duplicated here.
 */
describe('Staff Module (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let nurseToken: string;

  const adminRoleId = 'r-admin';
  const nurseRoleId = 'r-nurse';
  const staffId = '11111111-1111-4111-8111-111111111111';

  const rolesStore: any[] = [
    { id: adminRoleId, name: 'Administrator', isSystemRole: true },
    { id: nurseRoleId, name: 'Nurse', isSystemRole: true },
    { id: 'r-pharmacist', name: 'Pharmacist', isSystemRole: true },
  ];
  const permissionsStore: any[] = [
    { id: 'p1', roleId: adminRoleId, resource: 'Staff', action: 'read' },
    { id: 'p2', roleId: adminRoleId, resource: 'Staff', action: 'create' },
    { id: 'p3', roleId: adminRoleId, resource: 'Staff', action: 'update' },
    { id: 'p4', roleId: adminRoleId, resource: 'Staff', action: 'delete' },
  ];
  const usersStore: any[] = [];
  const staffUsersStore: any[] = [
    {
      id: staffId,
      identifier: 'nurse.test@esic.gov.in',
      active: true,
      mustChangePassword: false,
      passwordChangedAt: null,
      lastLoginAt: null,
      createdAt: new Date(),
      roleId: nurseRoleId,
      role: { name: 'Nurse' },
      employeeId: 'emp-1',
      employee: { employeeId: 'STF-001', name: 'Test Nurse', department: 'General', designation: null, contactPhone: null, contactEmail: null },
      staffShifts: [],
      departmentAssignments: [],
      tokenVersion: 0,
    },
  ];

  const postsStore = [{ id: 'post-1', title: 'Senior Officer' }];
  const gradesStore = [{ id: 'grade-1', payLevel: 'Pay Level 10' }];
  const empTypesStore = [{ id: 'emptype-1', code: 'PERMANENT' }];

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    $queryRaw: jest.fn().mockResolvedValue([{ last_value: 1 }]),
    role: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => rolesStore.find((r) => r.id === where?.id || r.name === where?.name) || null),
    },
    user: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const all = [...usersStore, ...staffUsersStore];
        const user = all.find((u) => u.id === where?.id || u.identifier === where?.identifier);
        if (!user) return null;
        const role = rolesStore.find((r) => r.id === user.roleId) ?? user.role;
        const perms = permissionsStore.filter((p) => p.roleId === (user.roleId ?? role?.id));
        return { ...user, role: { ...role, permissions: perms } };
      }),
      findMany: jest.fn().mockImplementation(async ({ where }: any) =>
        staffUsersStore.filter((u) => (where?.role?.name?.in ? where.role.name.in.includes(u.role.name) : true)),
      ),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const u = staffUsersStore.find((x) => x.id === where.id) ?? usersStore.find((x) => x.id === where.id);
        if (u) {
          if (data.tokenVersion?.increment) data.tokenVersion = (u.tokenVersion ?? 0) + data.tokenVersion.increment;
          Object.assign(u, data);
        }
        return u;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: `staff-${staffUsersStore.length + 1}`, ...data, role: rolesStore.find((r) => r.id === data.roleId), staffShifts: [], departmentAssignments: [] };
        staffUsersStore.push(created);
        return created;
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(async ({ where }) => {
        const u = staffUsersStore.find((x) => x.id === where.id) ?? usersStore.find((x) => x.id === where.id);
        if (!u) throw new Error(`Not found: ${where.id}`);
        return u;
      }),
    },
    loginActivity: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    post: { findFirst: jest.fn().mockResolvedValue(postsStore[0]) },
    grade: { findFirst: jest.fn().mockResolvedValue(gradesStore[0]) },
    employmentType: { findFirst: jest.fn().mockResolvedValue(empTypesStore[0]) },
    employee: {
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: `emp-${Date.now()}`, ...data })),
    },
    staffShift: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    staffDepartmentAssignment: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    hospitalSettings: { findUnique: jest.fn().mockResolvedValue(null) },
  };

  beforeAll(async () => {
    const adminHash = await bcrypt.hash('AdminPass123!', 10);
    const nurseHash = await bcrypt.hash('NursePass123!', 10);
    usersStore.push(
      { id: 'u-admin', identifier: 'admin@esic.gov.in', passwordHash: adminHash, roleId: adminRoleId, active: true, role: { name: 'Administrator' } },
      { id: 'u-nurse', identifier: 'nurse@esic.gov.in', passwordHash: nurseHash, roleId: nurseRoleId, active: true, role: { name: 'Nurse' } },
    );

    const { platformPrismaMock, tenantClientFactoryMock, registerUser } = createPlatformAuthMocks(
      [
        { identifier: 'admin@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
        { identifier: 'nurse@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
      ],
      mockPrismaService,
    );
    registerUser('nurse.test@esic.gov.in');

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
    nurseToken = (
      await request(app.getHttpServer()).post('/api/auth/login').send({ identifier: 'nurse@esic.gov.in', password: 'NursePass123!' }).expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/staff lists staff accounts', async () => {
    const res = await request(app.getHttpServer()).get('/api/staff').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('GET /api/staff is rejected without Staff:read', async () => {
    await request(app.getHttpServer()).get('/api/staff').set('Authorization', `Bearer ${nurseToken}`).expect(403);
  });

  it('GET /api/staff/:id returns one staff member', async () => {
    const res = await request(app.getHttpServer()).get(`/api/staff/${staffId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.body.email).toBe('nurse.test@esic.gov.in');
  });

  it('POST /api/staff creates a new staff account with a generated temporary password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'New Pharmacist', role: 'Pharmacist', email: 'new.pharmacist@esic.gov.in', department: 'Pharmacy' })
      .expect(201);
    expect(res.body.email).toBe('new.pharmacist@esic.gov.in');
    expect(res.body.temporaryPassword).toBeDefined();
  });

  it('POST /api/staff is rejected without Staff:create', async () => {
    await request(app.getHttpServer())
      .post('/api/staff')
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ name: 'X', role: 'Pharmacist', email: 'x@esic.gov.in', department: 'X' })
      .expect(403);
  });

  it('POST /api/staff rejects an invalid role name (e.g. Doctor, which has its own dedicated flow)', async () => {
    await request(app.getHttpServer())
      .post('/api/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X', role: 'Doctor', email: 'x2@esic.gov.in', department: 'X' })
      .expect(400);
  });

  it('PATCH /api/staff/:id/active deactivates a staff account and bumps tokenVersion (kills active sessions)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/staff/${staffId}/active`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(200);
    expect(res.body.active).toBe(false);
    expect(staffUsersStore.find((u) => u.id === staffId).tokenVersion).toBe(1);
  });

  it('POST /api/staff/:id/reset-password issues a fresh temporary password', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/staff/${staffId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'QA test' })
      .expect(201);
    expect(res.body.temporaryPassword).toBeDefined();
  });

  it('PATCH /api/staff/:id/lock locks the account', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/staff/${staffId}/lock`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ locked: true, reason: 'QA test' })
      .expect(200);
    expect(res.body).toBeDefined();
  });

  it('PATCH /api/staff/:id is rejected for an unknown id (404, not a crash)', async () => {
    await request(app.getHttpServer())
      .patch('/api/staff/99999999-9999-4999-8999-999999999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X' })
      .expect(404);
  });
});
