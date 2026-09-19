import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

describe('Repeat Visit Lookup & History (e2e)', () => {
  let app: INestApplication;
  let receptionistToken: string;

  const rolesStore: any[] = [
    { id: '00000000-0000-0000-0000-000000000001', name: 'Reception', isSystemRole: true },
  ];

  const permissionsStore: any[] = [
    {
      id: 'p1',
      roleId: '00000000-0000-0000-0000-000000000001',
      resource: 'Employee',
      action: 'read',
    },
    {
      id: 'p2',
      roleId: '00000000-0000-0000-0000-000000000001',
      resource: 'Visit',
      action: 'create',
    },
  ];

  const usersStore: any[] = [];
  const employeesStore: any[] = [
    {
      id: '00000000-0000-0000-0000-000000000100',
      employeeId: 'EMP-1001',
      name: 'Rajesh Kumar',
      department: 'Public Works Department',
      post: { title: 'Clerk' },
      grade: { payLevel: 'Pay Level 4' },
      employmentType: { name: 'Permanent Employee' },
      patientProfile: { eligibilityCategory: 'C' },
      hospitalUid: { uidCode: 'ESIC-2026-000001' },
    },
  ];
  const visitsStore: any[] = [];

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
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        const uidCode =
          where?.OR?.find((o: any) => o.hospitalUid?.uidCode)?.hospitalUid?.uidCode?.equals;
        const employeeId = where?.OR?.find((o: any) => o.employeeId)?.employeeId?.equals;
        const id = where?.OR?.find((o: any) => o.id)?.id;

        const emp = employeesStore.find(
          (e) =>
            (uidCode && e.hospitalUid?.uidCode === uidCode) ||
            (employeeId && e.employeeId === employeeId) ||
            (id && e.id === id),
        );

        if (!emp) return null;
        const empVisits = visitsStore.filter((v) => v.employeeId === emp.id);
        return { ...emp, visits: empVisits };
      }),
    },
    department: {
      findUnique: jest.fn().mockResolvedValue({ id: 'dept-1', code: 'GENMED', name: 'General Medicine' }),
      create: jest.fn().mockResolvedValue({ id: 'dept-1', code: 'GENMED', name: 'General Medicine' }),
    },
    post: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'post-1', title: 'Senior Officer' },
        { id: 'post-2', title: 'Officer' },
        { id: 'post-3', title: 'Clerk' },
        { id: 'post-4', title: 'Assistant' },
        { id: 'post-5', title: 'Support Staff' },
        { id: 'post-6', title: 'Contract Worker' },
      ]),
    },
    facilityEligibilityRule: {
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn(),
    },
    employmentType: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        if (where?.code === 'CONTRACTUAL') {
          return { id: 'emp-contractual', code: 'CONTRACTUAL', name: 'Contractual Employee' };
        }
        if (where?.code === 'PERMANENT') {
          return { id: 'emp-permanent', code: 'PERMANENT', name: 'Permanent Employee' };
        }
        return null;
      }),
    },
    benefitRule: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    admission: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    prescription: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    visit: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        return (
          visitsStore.find(
            (v) => v.employeeId === where?.employeeId && v.status === where?.status,
          ) || null
        );
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const newVisit = {
          id: `00000000-0000-0000-0000-${Date.now().toString().padStart(12, '0')}`,
          ...data,
          createdAt: new Date(),
        };
        visitsStore.push(newVisit);
        return newVisit;
      }),
      findMany: jest.fn().mockImplementation(async ({ where }) => {
        return visitsStore.filter((v) => v.employeeId === where?.employeeId);
      }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  beforeAll(async () => {
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

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'reception@esic.gov.in', password: 'ReceptionPass123!' })
      .expect(200);

    receptionistToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Single-Request Patient Profile & History Lookup', () => {
    it('should return patient profile and history summary in a single HTTP request', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients/lookup?uid=ESIC-2026-000001')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);

      expect(response.body.employee).toBeDefined();
      expect(response.body.employee.uid).toBe('ESIC-2026-000001');
      expect(response.body.employee.name).toBe('Rajesh Kumar');
      expect(response.body.historySummary).toBeDefined();
    });
  });

  describe('2. Visit Creation & Open Visit Warning (Module 2)', () => {
    it('should create an OPD Visit for a looked-up employee', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          employeeId: '00000000-0000-0000-0000-000000000100',
          type: 'OPD',
        })
        .expect(201);

      expect(res.body.status).toBe('CREATED');
      expect(res.body.visit).toBeDefined();
      expect(res.body.visit.type).toBe('OPD');
      expect(res.body.visit.status).toBe('OPEN');
    });

    it('should warn when creating a second visit if an open visit already exists', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          employeeId: '00000000-0000-0000-0000-000000000100',
          type: 'IPD',
        })
        .expect(201);

      expect(res.body.status).toBe('OPEN_VISIT_WARNING');
      expect(res.body.openVisit).toBeDefined();
    });
  });
});
