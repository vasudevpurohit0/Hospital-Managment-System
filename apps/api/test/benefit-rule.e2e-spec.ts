import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

describe('Employment-Type Benefit Rules Engine (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;

  const rolesStore: any[] = [{ id: 'r-admin', name: 'SuperAdmin', isSystemRole: true }];

  const permissionsStore: any[] = [
    { id: 'p1', roleId: 'r-admin', resource: 'Employee', action: 'read' },
    { id: 'p2', roleId: 'r-admin', resource: 'Employee', action: 'create' },
    { id: 'p3', roleId: 'r-admin', resource: 'BenefitRule', action: 'create' },
    { id: 'p4', roleId: 'r-admin', resource: 'BenefitRule', action: 'update' },
  ];

  const usersStore: any[] = [];
  const rulesStore: any[] = [
    {
      id: '33333333-3333-4333-8333-333333333333',
      employmentTypeId: 'emp-contractual',
      medicineCategory: null,
      outcome: 'PAID',
      active: true,
      version: 1,
    },
    {
      id: 'r-permanent-e2e',
      employmentTypeId: 'emp-permanent',
      medicineCategory: null,
      outcome: 'COVERED',
      active: true,
      version: 1,
    },
  ];

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    role: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        return rolesStore.find((r) => r.id === where?.id || r.name === where?.name) || null;
      }),
    },
    user: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const user = usersStore.find(
          (u) => u.id === where?.id || u.identifier === where?.identifier,
        );
        if (!user) return null;
        const role = rolesStore.find((r) => r.id === user.roleId);
        const perms = permissionsStore.filter((p) => p.roleId === user.roleId);
        return { ...user, role: { ...role, permissions: perms } };
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    loginActivity: { create: jest.fn().mockResolvedValue({}) },
    employmentType: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        if (where?.code === 'CONTRACTUAL') return { id: 'emp-contractual', code: 'CONTRACTUAL' };
        if (where?.code === 'PERMANENT') return { id: 'emp-permanent', code: 'PERMANENT' };
        return null;
      }),
    },
    benefitRule: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        const code = where?.employmentType?.code || 'CONTRACTUAL';
        return (
          rulesStore.find((r) => r.outcome === (code === 'CONTRACTUAL' ? 'PAID' : 'COVERED')) ||
          null
        );
      }),
      findMany: jest.fn().mockResolvedValue(rulesStore),
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        return rulesStore.find((r) => r.id === where?.id) || null;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const r = rulesStore.find((item) => item.id === where?.id);
        if (r) {
          Object.assign(r, data);
        }
        return r;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const r = { id: `r-${Date.now()}`, version: 1, ...data };
        rulesStore.push(r);
        return r;
      }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  beforeAll(async () => {
    const adminHash = await bcrypt.hash('AdminPass123!', 10);

    usersStore.push({
      id: '00000000-0000-0000-0000-000000000077',
      identifier: 'admin@esic.gov.in',
      passwordHash: adminHash,
      roleId: 'r-admin',
      active: true,
    });

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [{ identifier: 'admin@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID }],
      mockPrismaService,
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
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

    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'admin@esic.gov.in', password: 'AdminPass123!' })
      .expect(200);

    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Single Evaluator Engine Endpoints', () => {
    it('should evaluate CONTRACTUAL as PAID by default (Spec §7)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/benefit-rules/evaluate?employmentType=CONTRACTUAL')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.employmentType).toBe('CONTRACTUAL');
      expect(res.body.outcome).toBe('PAID');
    });

    it('should evaluate PERMANENT as COVERED by default', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/benefit-rules/evaluate?employmentType=PERMANENT')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.employmentType).toBe('PERMANENT');
      expect(res.body.outcome).toBe('COVERED');
    });
  });

  describe('2. Rule Admin Editing & Version Discipline', () => {
    it('should allow Admin to update a BenefitRule and increment rule version', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/benefit-rules/33333333-3333-4333-8333-333333333333')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ outcome: 'COVERED' })
        .expect(200);

      expect(res.body.version).toBe(2);
      expect(res.body.outcome).toBe('COVERED');
    });
  });
});
