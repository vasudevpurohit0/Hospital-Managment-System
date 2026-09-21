import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

/** RBAC Admin module (e2e): first automated HTTP-level coverage. */
describe('RBAC Admin Module (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let nurseToken: string;

  const adminRoleId = '11111111-1111-4111-8111-111111111111';
  const nurseRoleId = '22222222-2222-4222-8222-222222222222';
  const superAdminRoleId = '33333333-3333-4333-8333-333333333333';

  const rolesStore: any[] = [
    { id: adminRoleId, name: 'Administrator', isSystemRole: true },
    { id: nurseRoleId, name: 'Nurse', isSystemRole: true },
    { id: superAdminRoleId, name: 'SuperAdmin', isSystemRole: true },
  ];
  let permissionsStore: any[] = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', roleId: adminRoleId, resource: 'RbacConfig', action: 'read' },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', roleId: adminRoleId, resource: 'RbacConfig', action: 'update' },
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', roleId: nurseRoleId, resource: 'Visit', action: 'read' },
    { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', roleId: superAdminRoleId, resource: '*', action: '*' },
  ];
  const usersStore: any[] = [];

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    role: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => rolesStore.find((r) => r.id === where?.id || r.name === where?.name) || null),
      findMany: jest.fn().mockImplementation(async () =>
        rolesStore.map((r) => ({
          ...r,
          _count: {
            permissions: permissionsStore.filter((p) => p.roleId === r.id).length,
            users: usersStore.filter((u) => u.roleId === r.id).length,
          },
        })),
      ),
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
    permission: {
      findMany: jest.fn().mockImplementation(async ({ where, distinct }: any) => {
        if (distinct) {
          const seen = new Set<string>();
          return permissionsStore.filter((p) => {
            const key = `${p.resource}:${p.action}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
        return permissionsStore.filter((p) => p.roleId === where?.roleId);
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const p = permissionsStore.find((x) => x.id === where.id);
        if (!p) return null;
        return { ...p, role: rolesStore.find((r) => r.id === p.roleId) };
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        if (permissionsStore.some((p) => p.roleId === data.roleId && p.resource === data.resource && p.action === data.action)) {
          throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        }
        const created = { id: `perm-new-${permissionsStore.length + 1}`, ...data };
        permissionsStore.push(created);
        return created;
      }),
      delete: jest.fn().mockImplementation(async ({ where }) => {
        permissionsStore = permissionsStore.filter((p) => p.id !== where.id);
        return {};
      }),
    },
  };

  beforeAll(async () => {
    const adminHash = await bcrypt.hash('AdminPass123!', 10);
    const nurseHash = await bcrypt.hash('NursePass123!', 10);
    usersStore.push(
      { id: 'u-admin', identifier: 'admin@esic.gov.in', passwordHash: adminHash, roleId: adminRoleId, active: true },
      { id: 'u-nurse', identifier: 'nurse@esic.gov.in', passwordHash: nurseHash, roleId: nurseRoleId, active: true },
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

  it('GET /api/rbac/roles lists every role with its permission/user counts', async () => {
    const res = await request(app.getHttpServer()).get('/api/rbac/roles').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const admin = res.body.find((r: any) => r.name === 'Administrator');
    expect(admin.permissionCount).toBe(2);
    expect(admin.userCount).toBe(1);
  });

  it('GET /api/rbac/roles is rejected without RbacConfig:read', async () => {
    await request(app.getHttpServer()).get('/api/rbac/roles').set('Authorization', `Bearer ${nurseToken}`).expect(403);
  });

  it("GET /api/rbac/roles/:id/permissions lists one role's grants", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/rbac/roles/${nurseRoleId}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual([expect.objectContaining({ resource: 'Visit', action: 'read' })]);
  });

  it('GET /api/rbac/roles/:id/permissions 404s for an unknown role', async () => {
    await request(app.getHttpServer())
      .get('/api/rbac/roles/99999999-9999-4999-8999-999999999999/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('GET /api/rbac/known-resource-actions returns the distinct resource:action pairs already in use', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/rbac/known-resource-actions')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const keys = res.body.map((r: any) => `${r.resource}:${r.action}`);
    expect(new Set(keys).size).toBe(keys.length); // truly distinct
  });

  it('POST /api/rbac/permissions grants a new permission to a role', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/rbac/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleId: nurseRoleId, resource: 'LabOrder', action: 'read' })
      .expect(201);
    expect(res.body.resource).toBe('LabOrder');
  });

  it('POST /api/rbac/permissions rejects a duplicate grant with 409', async () => {
    await request(app.getHttpServer())
      .post('/api/rbac/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleId: nurseRoleId, resource: 'Visit', action: 'read' })
      .expect(409);
  });

  it('POST /api/rbac/permissions refuses the universal wildcard (*:*)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/rbac/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleId: nurseRoleId, resource: '*', action: 'read' })
      .expect(400);
    expect(res.body.message).toMatch(/wildcard/i);
  });

  it('POST /api/rbac/permissions is rejected without RbacConfig:update', async () => {
    await request(app.getHttpServer())
      .post('/api/rbac/permissions')
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ roleId: nurseRoleId, resource: 'X', action: 'read' })
      .expect(403);
  });

  it('DELETE /api/rbac/permissions/:id revokes a grant', async () => {
    await request(app.getHttpServer()).delete('/api/rbac/permissions/cccccccc-cccc-4ccc-8ccc-cccccccccccc').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(permissionsStore.some((p) => p.id === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toBe(false);
  });

  it('DELETE /api/rbac/permissions/:id refuses to touch a SuperAdmin permission row', async () => {
    const res = await request(app.getHttpServer())
      .delete('/api/rbac/permissions/dddddddd-dddd-4ddd-8ddd-dddddddddddd')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    expect(res.body.message).toMatch(/superadmin/i);
    expect(permissionsStore.some((p) => p.id === 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toBe(true);
  });

  it('DELETE /api/rbac/permissions/:id 404s for an unknown permission id', async () => {
    await request(app.getHttpServer())
      .delete('/api/rbac/permissions/99999999-9999-4999-8999-999999999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });
});
