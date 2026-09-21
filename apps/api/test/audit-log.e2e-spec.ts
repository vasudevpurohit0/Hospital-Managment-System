import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

/** Hospital-scoped Activity Log module (e2e): first automated HTTP-level coverage. */
describe('Audit Log Module (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let nurseToken: string;

  const rolesStore: any[] = [
    { id: 'r-admin', name: 'Administrator', isSystemRole: true },
    { id: 'r-nurse', name: 'Nurse', isSystemRole: true },
  ];
  const permissionsStore: any[] = [{ id: 'p1', roleId: 'r-admin', resource: 'AuditLog', action: 'read' }];
  const usersStore: any[] = [];

  const logsStore: any[] = [
    { id: 'log-1', createdAt: new Date('2026-01-02'), action: 'auth.login_success', severity: 'LOW', status: 'SUCCESS' },
    { id: 'log-2', createdAt: new Date(), action: 'auth.login_failed', severity: 'HIGH', status: 'FAILURE' },
    { id: 'log-3', createdAt: new Date(), action: 'staff.created', severity: 'CRITICAL', status: 'SUCCESS' },
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
    auditLog: {
      findMany: jest.fn().mockImplementation(async ({ where }: any) => {
        let rows = logsStore;
        if (where?.action) rows = rows.filter((r) => r.action === where.action);
        if (where?.severity) rows = rows.filter((r) => r.severity === where.severity);
        return rows;
      }),
      count: jest.fn().mockImplementation(async (args: any) => {
        const where = args?.where;
        if (!where) return logsStore.length;
        if (where.createdAt?.gte) return logsStore.filter((r) => r.createdAt >= where.createdAt.gte).length;
        if (where.severity) return logsStore.filter((r) => r.severity === where.severity).length;
        if (where.action) return logsStore.filter((r) => r.action === where.action).length;
        return logsStore.length;
      }),
      create: jest.fn().mockResolvedValue({}),
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

  it('GET /api/audit-log lists entries, paginated', async () => {
    const res = await request(app.getHttpServer()).get('/api/audit-log').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.body.meta?.total ?? res.body.total).toBe(3);
    expect((res.body.items ?? res.body.data ?? res.body).length).toBeGreaterThan(0);
  });

  it('GET /api/audit-log filters by severity', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/audit-log?severity=CRITICAL')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const items = res.body.items ?? res.body.data ?? res.body;
    expect(items.every((r: any) => r.severity === 'CRITICAL')).toBe(true);
  });

  it('GET /api/audit-log is rejected without AuditLog:read', async () => {
    await request(app.getHttpServer()).get('/api/audit-log').set('Authorization', `Bearer ${nurseToken}`).expect(403);
  });

  it('GET /api/audit-log/stats returns aggregate counts', async () => {
    const res = await request(app.getHttpServer()).get('/api/audit-log/stats').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.body.total).toBe(3);
    expect(res.body.critical).toBe(1);
    expect(res.body.failedLogins).toBe(1);
  });

  it('GET /api/audit-log/export.csv downloads a CSV with the expected header row', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/audit-log/export.csv')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/activity-log\.csv/);
    expect(res.text.split('\n')[0]).toMatch(/Timestamp,Actor/);
  });

  it('GET /api/audit-log/export.csv is rejected without AuditLog:read', async () => {
    await request(app.getHttpServer()).get('/api/audit-log/export.csv').set('Authorization', `Bearer ${nurseToken}`).expect(403);
  });
});
