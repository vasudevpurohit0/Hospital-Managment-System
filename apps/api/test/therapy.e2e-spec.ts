import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

/**
 * Therapy module (e2e): first automated HTTP-level coverage. Scoped to the
 * standalone-session lifecycle (schedule -> perform/cancel/no-show -> list)
 * plus RBAC. `openCourse` and a standalone (non-course) `performSession` both
 * also call into `ChargeService.postServiceCharge()` -- already covered by
 * `charge.service.integration.spec.ts` -- so this spec exercises `performSession` on a
 * course-linked session (skips the charge, per the service's own "a course
 * already paid for it up front" rule) rather than re-mocking the entire
 * pricing/billing chain here too.
 */
describe('Therapy Module (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let receptionToken: string;

  const rolesStore: any[] = [
    { id: 'r-admin', name: 'Administrator', isSystemRole: true },
    { id: 'r-reception', name: 'Reception', isSystemRole: true },
  ];
  const permissionsStore: any[] = [
    { id: 'p1', roleId: 'r-admin', resource: 'TherapySession', action: 'read' },
    { id: 'p2', roleId: 'r-admin', resource: 'TherapySession', action: 'create' },
    { id: 'p3', roleId: 'r-admin', resource: 'TherapySession', action: 'update' },
  ];
  const usersStore: any[] = [];

  const visitId = '11111111-1111-4111-8111-111111111111';
  const serviceId = '22222222-2222-4222-8222-222222222222';
  const courseSessionId = '33333333-3333-4333-8333-333333333333';

  const sessionsStore: any[] = [
    {
      id: courseSessionId,
      visitId,
      admissionId: null,
      serviceId,
      courseId: 'course-1',
      sessionNumber: 1,
      status: 'SCHEDULED',
      source: 'DIRECT',
      service: { id: serviceId, name: 'Panchakarma Session', serviceType: 'THERAPY' },
    },
  ];
  const coursesStore: any[] = [{ id: 'course-1', visitId, plannedSessions: 3, status: 'IN_PROGRESS' }];

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
    service: {
      findUnique: jest.fn().mockImplementation(async ({ where }) =>
        where.id === serviceId ? { id: serviceId, name: 'Panchakarma Session', serviceType: 'THERAPY' } : null,
      ),
    },
    visit: {
      findUnique: jest.fn().mockImplementation(async ({ where }) =>
        where.id === visitId
          ? { id: visitId, opdVisit: null, employee: { employmentType: { code: 'CONTRACTUAL' } } }
          : null,
      ),
    },
    benefitRule: {
      findFirst: jest.fn().mockResolvedValue({ outcome: 'PAID' }),
    },
    therapySession: {
      findMany: jest.fn().mockImplementation(async ({ where }: any) =>
        sessionsStore.filter((s) => (where?.visitId ? s.visitId === where.visitId : true) && (where?.courseId ? s.courseId === where.courseId : true)),
      ),
      findUnique: jest.fn().mockImplementation(async ({ where }) => sessionsStore.find((s) => s.id === where.id) ?? null),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const created = { id: randomUUID(), service: { name: 'Panchakarma Session' }, ...data };
        sessionsStore.push(created);
        return created;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const s = sessionsStore.find((x) => x.id === where.id);
        Object.assign(s, data);
        return { ...s, service: { name: 'Panchakarma Session' }, chargeItems: [] };
      }),
    },
    therapyCourse: {
      findMany: jest.fn().mockResolvedValue(coursesStore),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const c = coursesStore.find((x) => x.id === where.id);
        Object.assign(c, data);
        return c;
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

  it('GET /api/therapy/sessions lists sessions for a visit', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/therapy/sessions?visitId=${visitId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('GET /api/therapy/courses lists courses', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/therapy/courses')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('POST /api/therapy/sessions schedules a standalone session', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/therapy/sessions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ visitId, serviceId })
      .expect(201);
    expect(res.body.status).toBe('SCHEDULED');
  });

  it('POST /api/therapy/sessions/:id/perform marks a course-linked session performed without a new charge, and completes the course once every sibling is performed', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/therapy/sessions/${courseSessionId}/perform`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(201);

    expect(res.body.status).toBe('PERFORMED');
    // Only sibling in course-1, so the course is now complete.
    expect(coursesStore.find((c) => c.id === 'course-1').status).toBe('COMPLETED');
  });

  it('POST /api/therapy/sessions/:id/perform rejects a session that is not SCHEDULED (already performed)', async () => {
    await request(app.getHttpServer())
      .post(`/api/therapy/sessions/${courseSessionId}/perform`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);
  });

  it('POST /api/therapy/sessions/:id/cancel cancels a scheduled session', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/therapy/sessions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ visitId, serviceId })
      .expect(201);

    const cancelRes = await request(app.getHttpServer())
      .post(`/api/therapy/sessions/${createRes.body.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(cancelRes.body.status).toBe('CANCELLED');
  });

  it('POST /api/therapy/sessions/:id/no-show marks a scheduled session as a no-show', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/therapy/sessions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ visitId, serviceId })
      .expect(201);

    const noShowRes = await request(app.getHttpServer())
      .post(`/api/therapy/sessions/${createRes.body.id}/no-show`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(noShowRes.body.status).toBe('NO_SHOW');
  });

  it('POST /api/therapy/sessions is rejected without TherapySession:create', async () => {
    await request(app.getHttpServer())
      .post('/api/therapy/sessions')
      .set('Authorization', `Bearer ${receptionToken}`)
      .send({ visitId, serviceId })
      .expect(403);
  });

  it('POST /api/therapy/sessions 404s for an unknown service', async () => {
    await request(app.getHttpServer())
      .post('/api/therapy/sessions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ visitId, serviceId: '99999999-9999-4999-8999-999999999999' })
      .expect(404);
  });
});
