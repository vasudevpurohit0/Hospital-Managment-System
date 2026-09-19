import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

describe('Employee Registration Concurrency & Double-Submit (e2e)', () => {
  let app: INestApplication;
  let receptionistToken: string;

  // In-memory data store for E2E testing without external DB connection
  const rolesStore: any[] = [
    { id: '00000000-0000-0000-0000-000000000001', name: 'Reception', isSystemRole: true },
  ];

  const permissionsStore: any[] = [
    {
      id: 'p1',
      roleId: '00000000-0000-0000-0000-000000000001',
      resource: 'Employee',
      action: 'create',
    },
    {
      id: 'p2',
      roleId: '00000000-0000-0000-0000-000000000001',
      resource: 'Employee',
      action: 'read',
    },
    {
      id: 'p3',
      roleId: '00000000-0000-0000-0000-000000000001',
      resource: 'HospitalUID',
      action: 'read',
    },
  ];

  const usersStore: any[] = [];
  const employeesStore: any[] = [];
  const hospitalUidsStore: any[] = [];
  const manualVerificationCasesStore: any[] = [];

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
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
    employee: {
      findUnique: jest.fn().mockImplementation(async (args) => {
        const id = args?.where?.id;
        const employeeId = args?.where?.employeeId;
        const emp = employeesStore.find(
          (e) => (id && e.id === id) || (employeeId && e.employeeId === employeeId),
        );
        if (!emp) return null;
        const uid = hospitalUidsStore.find((u) => u.employeeId === emp.id);
        return { ...emp, hospitalUid: uid || null };
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        // Enforce database-level uniqueness simulation
        const existing = employeesStore.find((e) => e.employeeId === data.employeeId);
        if (existing) {
          const err: any = new Error('Unique constraint failed on employee_id');
          err.code = 'P2002';
          throw err;
        }
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
    },
    hospitalUID: {
      count: jest.fn().mockImplementation(async () => hospitalUidsStore.length),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const newUid = {
          id: `00000000-0000-0000-0000-${Date.now().toString().padStart(12, '0')}`,
          ...data,
          issuedAt: new Date(),
        };
        hospitalUidsStore.push(newUid);
        return newUid;
      }),
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        if (where?.OR) {
          const uidCode = where.OR.find((o: any) => o.uidCode)?.uidCode;
          const employeeId = where.OR.find((o: any) => o.employee?.employeeId)?.employee
            ?.employeeId;

          const uid = hospitalUidsStore.find((u) => u.uidCode === uidCode);
          if (uid) {
            const emp = employeesStore.find((e) => e.id === uid.employeeId);
            return { ...uid, employee: emp };
          }

          const emp = employeesStore.find((e) => e.employeeId === employeeId);
          if (emp) {
            const uidByEmp = hospitalUidsStore.find((u) => u.employeeId === emp.id);
            return uidByEmp ? { ...uidByEmp, employee: emp } : null;
          }
        }
        return null;
      }),
    },
    patientProfile: {
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: `00000000-0000-0000-0000-${Date.now().toString().padStart(12, '0')}`,
        ...data,
      })),
    },
    post: {
      findUnique: jest.fn().mockResolvedValue({ id: 'p1', title: 'Clerk' }),
      create: jest.fn().mockResolvedValue({ id: 'p1', title: 'Clerk' }),
    },
    grade: {
      findFirst: jest.fn().mockResolvedValue({ id: 'g1', payLevel: 'Pay Level 4' }),
      create: jest.fn().mockResolvedValue({ id: 'g1', payLevel: 'Pay Level 4' }),
    },
    employmentType: {
      findUnique: jest.fn().mockResolvedValue({ id: 'et1', code: 'PERMANENT', name: 'Permanent' }),
      create: jest.fn().mockResolvedValue({ id: 'et1', code: 'PERMANENT', name: 'Permanent' }),
    },
    manualVerificationCase: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        const newCase = {
          id: `case-${Date.now()}`,
          ...data,
          createdAt: new Date(),
        };
        manualVerificationCasesStore.push(newCase);
        return newCase;
      }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
  };

  beforeAll(async () => {
    // Seed Reception user
    const passwordHash = await bcrypt.hash('ReceptionPass123!', 10);
    usersStore.push({
      id: '00000000-0000-0000-0000-000000000099',
      identifier: 'reception@esic.gov.in',
      passwordHash,
      roleId: '00000000-0000-0000-0000-000000000001',
      active: true,
    });

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [{ identifier: 'reception@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID }],
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

    // Login Receptionist
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'reception@esic.gov.in', password: 'ReceptionPass123!' })
      .expect(200);

    receptionistToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Concurrent Double-Submit Protection (FR-EMP-06)', () => {
    it('should allow only ONE registration to succeed and reject simultaneous duplicate with 409 Conflict', async () => {
      const targetEmpId = 'EMP-1001';

      // Fire two concurrent registration requests simultaneously
      const [response1, response2] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/employees/register')
          .set('Authorization', `Bearer ${receptionistToken}`)
          .send({ employeeId: targetEmpId }),
        request(app.getHttpServer())
          .post('/api/employees/register')
          .set('Authorization', `Bearer ${receptionistToken}`)
          .send({ employeeId: targetEmpId }),
      ]);

      const statuses = [response1.status, response2.status];

      // Exactly ONE request must be 201 Created and ONE must be 409 Conflict
      expect(statuses).toContain(201);
      expect(statuses).toContain(409);

      // Verify that strictly 1 HospitalUID record exists for this employee
      const uidsForEmp = hospitalUidsStore.filter(
        (u) => u.employeeId === employeesStore.find((e) => e.employeeId === targetEmpId)?.id,
      );
      expect(uidsForEmp.length).toBe(1);
    });
  });

  describe('2. Manual Verification Fallback on Verification Failure (FR-EMP-02)', () => {
    it('should create a Pending Manual Verification case for unverified employee ID', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/employees/register')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({ employeeId: 'UNVERIFIED-9999' })
        .expect(201);

      expect(response.body.status).toBe('MANUAL_VERIFICATION_PENDING');
      expect(response.body.caseId).toBeDefined();

      const createdCase = manualVerificationCasesStore.find(
        (c) => c.employeeId === 'UNVERIFIED-9999',
      );
      expect(createdCase).toBeDefined();
      expect(createdCase.status).toBe('PENDING');
    });
  });

  describe('3. Printable UID Card Data Endpoint & QR Code Generation (FR-EMP-04)', () => {
    it('should return valid UID card details with a PNG QR Data URL', async () => {
      // First ensure EMP-1002 is registered
      await request(app.getHttpServer())
        .post('/api/employees/register')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({ employeeId: 'EMP-1002' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/employees/EMP-1002/card')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);

      expect(response.body.uidCode).toBeDefined();
      expect(response.body.uidCode.startsWith('ESIC-')).toBe(true);
      expect(response.body.qrDataUrl).toBeDefined();
      expect(response.body.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
      expect(response.body.employee.name).toBe('Sunita Sharma');
    });
  });
});
