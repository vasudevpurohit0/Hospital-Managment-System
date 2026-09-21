import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

/** Facility Eligibility Rules module (e2e): first automated HTTP-level coverage. */
describe('Facility Eligibility Rules Module (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let nurseToken: string;

  const rolesStore: any[] = [
    { id: 'r-admin', name: 'Administrator', isSystemRole: true },
    { id: 'r-nurse', name: 'Nurse', isSystemRole: true },
  ];
  const permissionsStore: any[] = [
    { id: 'p1', roleId: 'r-admin', resource: 'FacilityEligibilityRule', action: 'read' },
    { id: 'p2', roleId: 'r-admin', resource: 'FacilityEligibilityRule', action: 'create' },
    { id: 'p3', roleId: 'r-admin', resource: 'FacilityEligibilityRule', action: 'update' },
    { id: 'p4', roleId: 'r-admin', resource: 'Employee', action: 'read' },
  ];
  const usersStore: any[] = [];

  const employee = { id: 'emp-1', employeeId: 'EMP-1001', gradeId: 'grade-10', postId: 'post-1' };
  const rulesStore: any[] = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      postId: null,
      gradeId: 'grade-10',
      category: 'A',
      wardEligibility: 'Private Ward',
      room: 'Single',
      facilityLevel: 'A',
      active: true,
      version: 1,
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
    employee: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        const match = where.OR.some((c: any) => c.id === employee.id || c.employeeId === employee.employeeId);
        return match ? employee : null;
      }),
    },
    facilityEligibilityRule: {
      findMany: jest.fn().mockResolvedValue(rulesStore),
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        if (where.gradeId) return rulesStore.find((r) => r.gradeId === where.gradeId && r.active) ?? null;
        if (where.postId !== undefined) return rulesStore.find((r) => r.postId === where.postId && r.gradeId === null && r.active) ?? null;
        return null;
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }) => rulesStore.find((r) => r.id === where.id) ?? null),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const r = rulesStore.find((x) => x.id === where.id);
        Object.assign(r, data);
        return r;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: `rule-${rulesStore.length + 1}`, ...data };
        rulesStore.push(created);
        return created;
      }),
    },
  };

  beforeAll(async () => {
    const adminHash = await bcrypt.hash('AdminPass123!', 10);
    const nurseHash = await bcrypt.hash('NursePass123!', 10);
    usersStore.push(
      { id: 'u-admin', identifier: 'admin@esic.gov.in', passwordHash: adminHash, roleId: 'r-admin', active: true },
      { id: 'u-nurse', identifier: 'nurse@esic.gov.in', passwordHash: nurseHash, roleId: 'r-nurse', active: true },
    );

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [
        { identifier: 'admin@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
        { identifier: 'nurse@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
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
    nurseToken = (
      await request(app.getHttpServer()).post('/api/auth/login').send({ identifier: 'nurse@esic.gov.in', password: 'NursePass123!' }).expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/facility-rules lists all rules', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/facility-rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('GET /api/facility-rules is rejected for Nurse (lacks FacilityEligibilityRule:read)', async () => {
    await request(app.getHttpServer()).get('/api/facility-rules').set('Authorization', `Bearer ${nurseToken}`).expect(403);
  });

  it('GET /api/facility-rules/resolve resolves an employee to their eligible ward category by grade', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/facility-rules/resolve?employeeId=EMP-1001')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual({
      category: 'A',
      wardEligibility: 'Private Ward',
      room: 'Single',
      facilityLevel: 'A',
      ruleId: '11111111-1111-4111-8111-111111111111',
      version: 1,
    });
  });

  it('GET /api/facility-rules/resolve returns 404 for an unknown employee', async () => {
    await request(app.getHttpServer())
      .get('/api/facility-rules/resolve?employeeId=NOBODY')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('POST /api/facility-rules creates a new rule at version 1', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/facility-rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gradeId: 'grade-7', category: 'B', wardEligibility: 'Semi-Private', room: 'Shared', facilityLevel: 'B' })
      .expect(201);
    expect(res.body.version).toBe(1);
    expect(res.body.active).toBe(true);
  });

  it('PUT /api/facility-rules/:id versions the rule instead of overwriting it (old version deactivated)', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/facility-rules/11111111-1111-4111-8111-111111111111')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'A', wardEligibility: 'Private Ward Deluxe', room: 'Single Deluxe', facilityLevel: 'A' })
      .expect(200);

    expect(res.body.version).toBe(2);
    expect(res.body.wardEligibility).toBe('Private Ward Deluxe');

    const oldVersion = rulesStore.find((r) => r.id === '11111111-1111-4111-8111-111111111111');
    expect(oldVersion.active).toBe(false);
  });

  it('PUT /api/facility-rules/:id is rejected for Nurse (lacks FacilityEligibilityRule:update)', async () => {
    await request(app.getHttpServer())
      .put('/api/facility-rules/11111111-1111-4111-8111-111111111111')
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ category: 'A', wardEligibility: 'x', room: 'x', facilityLevel: 'A' })
      .expect(403);
  });
});
