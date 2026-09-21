import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

describe('OPD Daily Token Concurrency (e2e)', () => {
  let app: INestApplication;
  let receptionistToken: string;

  const rolesStore: any[] = [
    { id: '00000000-0000-0000-0000-000000000001', name: 'Reception', isSystemRole: true },
    { id: '00000000-0000-0000-0000-00000000000d', name: 'Doctor', isSystemRole: true },
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
    {
      id: 'p3',
      roleId: '00000000-0000-0000-0000-000000000001',
      resource: 'OPDVisit',
      action: 'create',
    },
  ];

  const usersStore: any[] = [];
  const deptCardio = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: 'Cardiology',
    code: 'CARDIO',
  };
  const doctorId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  const opdVisitsStore: any[] = [];

  // In-memory analog of the real `document_sequences` table's atomic
  // INSERT..ON CONFLICT..RETURNING upsert (DocumentSequenceService.allocate())
  // -- keyed by "<name>:<periodKey>", exactly like the real unique
  // constraint, so 20 concurrent requests still get 20 unique, gapless values.
  const sequenceCounters = new Map<string, number>();

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    $queryRaw: jest.fn().mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const [name, , periodKey] = values as [string, string, string];
      const key = `${name}:${periodKey}`;
      const next = (sequenceCounters.get(key) ?? 0) + 1;
      sequenceCounters.set(key, next);
      return [{ last_value: next }];
    }),
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
    visit: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => ({ id: where.id, employeeId: 'emp-1', type: 'OPD', status: 'OPEN' })),
    },
    department: {
      findUnique: jest.fn().mockResolvedValue(deptCardio),
      findMany: jest.fn().mockResolvedValue([deptCardio]),
    },
    // No CONSULT-GEN service seeded -- createOpdVisit()'s best-effort
    // consultation-charge block is meant to quietly skip in that case,
    // exactly like it does in the real, unpriced-by-default app.
    service: { findUnique: jest.fn().mockResolvedValue(null) },
    oPDVisit: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        const item = {
          id: `opd-${Date.now()}-${Math.random()}`,
          ...data,
          department: deptCardio,
          createdAt: new Date(),
        };
        opdVisitsStore.push(item);
        return item;
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
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
    // createOpdVisit() requires a real, eligible doctor (assertDoctorEligibleForDepartment).
    usersStore.push({
      id: doctorId,
      identifier: 'cardio.doctor@esic.gov.in',
      passwordHash,
      roleId: '00000000-0000-0000-0000-00000000000d',
      active: true,
      doctorProfile: { departmentId: deptCardio.id, departments: [] },
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

  it('should handle 20 concurrent token-creation requests for the same department producing 20 unique, gapless token numbers', async () => {
    const CONCURRENCY_COUNT = 20;

    // Fire 20 parallel token creation requests simultaneously
    const requests = Array.from({ length: CONCURRENCY_COUNT }).map((_, index) =>
      request(app.getHttpServer())
        .post('/api/opd-visits')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          visitId: `44444444-4444-4444-8444-${(index + 1).toString().padStart(12, '0')}`,
          departmentId: deptCardio.id,
          doctorId,
        }),
    );

    const responses = await Promise.all(requests);

    // 1. All 20 requests must succeed with HTTP 201 Created
    responses.forEach((res) => {
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('CREATED');
      expect(res.body.tokenNumber).toBeDefined();
    });

    // 2. Collect all token numbers
    const tokens = responses.map((res) => res.body.tokenNumber);

    // 3. Assert all 20 tokens are strictly unique (no duplicates / collisions)
    const uniqueTokens = new Set(tokens);
    expect(uniqueTokens.size).toBe(CONCURRENCY_COUNT);

    // 4. Assert token numbers form a gapless sequence from CARDIO-001 to CARDIO-020
    const expectedTokens = Array.from({ length: CONCURRENCY_COUNT }).map(
      (_, i) => `CARDIO-${(i + 1).toString().padStart(3, '0')}`,
    );

    expect(tokens.sort()).toEqual(expectedTokens.sort());
  });
});
