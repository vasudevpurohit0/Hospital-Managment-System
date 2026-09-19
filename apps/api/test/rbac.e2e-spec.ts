import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

describe('RBAC & Core Data Model (e2e)', () => {
  let app: INestApplication;

  let superAdminToken: string;
  let dataEntryToken: string;
  let registerBillingClerk: (identifier: string, hospitalId?: string | null) => void;

  // In-memory data store for E2E testing without external DB connection
  const rolesStore: any[] = [
    { id: '00000000-0000-0000-0000-000000000001', name: 'SuperAdmin', isSystemRole: true },
    { id: '00000000-0000-0000-0000-000000000002', name: 'DataEntryOperator', isSystemRole: true },
  ];

  const permissionsStore: any[] = [
    // SuperAdmin wildcard
    { id: 'p1', roleId: '00000000-0000-0000-0000-000000000001', resource: '*', action: '*' },

    // DataEntryOperator restricted permissions (Employee create/read/update demographic only)
    {
      id: 'p2',
      roleId: '00000000-0000-0000-0000-000000000002',
      resource: 'Employee',
      action: 'create',
    },
    {
      id: 'p3',
      roleId: '00000000-0000-0000-0000-000000000002',
      resource: 'Employee',
      action: 'read',
    },
    {
      id: 'p4',
      roleId: '00000000-0000-0000-0000-000000000002',
      resource: 'Employee',
      action: 'update',
    },
  ];

  const usersStore: any[] = [];
  const auditLogsStore: any[] = [];
  const employeesStore: any[] = [];

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    role: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        return rolesStore.find((r) => r.id === where?.id || r.name === where?.name) || null;
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(async ({ where }) => {
        const found = rolesStore.find((r) => r.id === where?.id || r.name === where?.name);
        if (!found) throw new Error('Role not found');
        return found;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const newRole = {
          id: `00000000-0000-0000-0000-${Date.now().toString().padStart(12, '0')}`,
          name: data.name,
          isSystemRole: data.isSystemRole || false,
        };
        rolesStore.push(newRole);

        if (data.permissions?.create) {
          for (const p of data.permissions.create) {
            permissionsStore.push({
              id: `perm-${Date.now()}-${Math.random()}`,
              roleId: newRole.id,
              resource: p.resource,
              action: p.action,
            });
          }
        }
        return newRole;
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

        return {
          ...user,
          role: {
            ...role,
            permissions: perms,
          },
        };
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const newUser = {
          id: `00000000-0000-0000-0000-${Date.now().toString().padStart(12, '0')}`,
          identifier: data.identifier,
          passwordHash: data.passwordHash,
          roleId: data.roleId,
          active: data.active ?? true,
        };
        usersStore.push(newUser);
        return newUser;
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    loginActivity: { create: jest.fn().mockResolvedValue({}) },
    auditLog: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        const newLog = {
          id: `00000000-0000-0000-0000-${Date.now().toString().padStart(12, '0')}`,
          ...data,
          createdAt: new Date(),
        };
        auditLogsStore.push(newLog);
        return newLog;
      }),
      count: jest.fn().mockImplementation(async () => auditLogsStore.length),
      findFirst: jest
        .fn()
        .mockImplementation(async () => auditLogsStore[auditLogsStore.length - 1] || null),
    },
    employee: {
      findUnique: jest.fn().mockImplementation(async (args) => {
        const id = args?.where?.id;
        const employeeId = args?.where?.employeeId;
        return (
          employeesStore.find(
            (e) => (id && e.id === id) || (employeeId && e.employeeId === employeeId),
          ) || null
        );
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const newEmp = {
          id: `00000000-0000-0000-0000-${Date.now().toString().padStart(12, '0')}`,
          ...data,
          post: { id: data.postId, title: 'Clerk' },
          grade: { id: data.gradeId, payLevel: 'Pay Level 4' },
          employmentType: { id: data.employmentTypeId, code: 'PERMANENT', name: 'Permanent' },
        };
        employeesStore.push(newEmp);
        return newEmp;
      }),
      findMany: jest.fn().mockImplementation(async () => employeesStore),
    },
  };

  beforeAll(async () => {
    // Populate test user credentials
    const saPasswordHash = await bcrypt.hash('SuperAdminSecret123!', 10);
    usersStore.push({
      id: '00000000-0000-0000-0000-000000000010',
      identifier: 'superadmin@esic.gov.in',
      passwordHash: saPasswordHash,
      roleId: '00000000-0000-0000-0000-000000000001',
      active: true,
    });

    const deopPasswordHash = await bcrypt.hash('DataEntryPass123!', 10);
    usersStore.push({
      id: '00000000-0000-0000-0000-000000000020',
      identifier: 'deop@esic.gov.in',
      passwordHash: deopPasswordHash,
      roleId: '00000000-0000-0000-0000-000000000002',
      active: true,
    });

    const { platformPrismaMock, tenantClientFactoryMock, registerUser } = createPlatformAuthMocks(
      [
        { identifier: 'superadmin@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
        { identifier: 'deop@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
      ],
      mockPrismaService,
    );
    registerBillingClerk = registerUser;

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

    // Login SuperAdmin
    const saLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'superadmin@esic.gov.in', password: 'SuperAdminSecret123!' })
      .expect(200);
    superAdminToken = saLogin.body.accessToken;

    // Login DataEntryOperator
    const deopLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'deop@esic.gov.in', password: 'DataEntryPass123!' })
      .expect(200);
    dataEntryToken = deopLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Authentication & Tokens', () => {
    it('should reject requests without a Bearer token with 401', async () => {
      await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    });

    it('should reject invalid Bearer token with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid_token_string')
        .expect(401);
    });

    it('should return user profile for valid Bearer token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${dataEntryToken}`)
        .expect(200);

      expect(response.body.user).toBeDefined();
      expect(response.body.user.roleName).toBe('DataEntryOperator');
    });
  });

  describe('2. DataEntryOperator Role Restrictions (FR-SEC-13)', () => {
    it('should REJECT DataEntryOperator on /api/facility-rules with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post('/api/facility-rules')
        .set('Authorization', `Bearer ${dataEntryToken}`)
        .send({ category: 'A' })
        .expect(403);
    });

    it('should REJECT DataEntryOperator on /api/benefit-rules with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post('/api/benefit-rules')
        .set('Authorization', `Bearer ${dataEntryToken}`)
        .send({ employmentTypeId: '00000000-0000-0000-0000-000000000001', outcome: 'FREE' })
        .expect(403);
    });

    it('should REJECT DataEntryOperator on /api/prescriptions with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${dataEntryToken}`)
        .send({
          visitId: '00000000-0000-0000-0000-000000000100',
          diagnosisText: 'Forbidden Test',
          items: [],
        })
        .expect(403);
    });

    it('should REJECT DataEntryOperator on /api/config/branding with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .put('/api/config/branding')
        .set('Authorization', `Bearer ${dataEntryToken}`)
        .send({ hospitalDisplayName: 'Hacked HMS' })
        .expect(403);
    });
  });

  describe('3. Data-Driven Role Extension without redeploy (FR-SEC-06)', () => {
    it('should allow access to new endpoints when a new Role + Permission row is inserted into DB', async () => {
      // Create a custom non-system role: "BillingClerk"
      const billingRole = await mockPrismaService.role.create({
        data: {
          name: 'BillingClerk',
          isSystemRole: false,
          permissions: {
            create: [{ resource: 'Employee', action: 'read' }],
          },
        },
      });

      // Create user assigned to "BillingClerk"
      const passwordHash = await bcrypt.hash('ClerkPass123!', 10);
      await mockPrismaService.user.create({
        data: {
          identifier: 'billingclerk@esic.gov.in',
          passwordHash,
          roleId: billingRole.id,
          active: true,
        },
      });
      // This user was created by calling mockPrismaService.user.create()
      // directly (bypassing the real registration flow, which would itself
      // call LoginDirectoryService.register()) -- so it needs registering in
      // the mocked platform directory by hand for its login below to resolve.
      registerBillingClerk('billingclerk@esic.gov.in');

      // Login as new Billing Clerk
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'billingclerk@esic.gov.in', password: 'ClerkPass123!' })
        .expect(200);

      const clerkToken = loginRes.body.accessToken;

      // Billing Clerk should be permitted to read Employees
      await request(app.getHttpServer())
        .get('/api/employees')
        .set('Authorization', `Bearer ${clerkToken}`)
        .expect(200);

      // Billing Clerk should be forbidden from creating Facility Rules
      await request(app.getHttpServer())
        .post('/api/facility-rules')
        .set('Authorization', `Bearer ${clerkToken}`)
        .send({ category: 'B' })
        .expect(403);
    });
  });

  describe('4. Automatic Audit Log Generation', () => {
    it('should create an append-only AuditLog row when a mutating POST request is performed', async () => {
      const initialLogsCount = auditLogsStore.length;

      const newEmpId = `EMP-TEST-${Date.now()}`;
      await request(app.getHttpServer())
        .post('/api/employees')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          employeeId: newEmpId,
          name: 'Test Employee Audit',
          department: 'Civil Services',
          postId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          gradeId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
          employmentTypeId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
        })
        .expect(201);

      expect(auditLogsStore.length).toBeGreaterThan(initialLogsCount);
      const latestLog = auditLogsStore[auditLogsStore.length - 1];

      expect(latestLog).toBeDefined();
      expect(latestLog.entityType).toBe('Employee');
      expect(latestLog.action).toBe('employee.post');
    });
  });
});
