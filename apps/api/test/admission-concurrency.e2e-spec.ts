import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import { AdmissionStatus, BedStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

describe('Admission Bed Allocation Concurrency (e2e)', () => {
  jest.setTimeout(60000);
  let app: INestApplication;
  let admissionDeskToken: string;

  const rolesStore: any[] = [
    { id: '00000000-0000-0000-0000-000000000002', name: 'AdmissionDesk', isSystemRole: true },
  ];

  const permissionsStore: any[] = [
    {
      id: 'p1',
      roleId: '00000000-0000-0000-0000-000000000002',
      resource: 'Admission',
      action: 'read',
    },
    {
      id: 'p2',
      roleId: '00000000-0000-0000-0000-000000000002',
      resource: 'Admission',
      action: 'update',
    },
  ];

  const usersStore: any[] = [];

  // Bed allocation concurrency state
  let bedOccupied = false;
  const mockBed = {
    id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    bedNumber: 'B-101',
    status: BedStatus.AVAILABLE,
    currentAdmissionId: null,
    roomId: 'room-1',
    room: {
      id: 'room-1',
      roomNumber: 'R-1',
      wardId: 'ward-1',
    },
  };

  const mockAdmission = {
    id: 'e8e19c96-6d63-4b68-8097-fbbd646b9db6',
    visitId: 'visit-1',
    status: AdmissionStatus.ELIGIBILITY_CHECKED,
    eligibleCategory: 'C',
    requestedAt: new Date(),
    visit: {
      id: 'visit-1',
      employee: {
        id: 'emp-1',
        name: 'Aditya Sen',
      },
    },
  };

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
    admission: {
      findUnique: jest.fn().mockResolvedValue(mockAdmission),
      findMany: jest.fn().mockResolvedValue([mockAdmission]),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        return {
          ...mockAdmission,
          ...data,
        };
      }),
    },
    bed: {
      findUnique: jest.fn().mockImplementation(async () => {
        return {
          ...mockBed,
          status: bedOccupied ? BedStatus.OCCUPIED : BedStatus.AVAILABLE,
          currentAdmissionId: bedOccupied ? 'other-adm' : null,
        };
      }),
      // Mock transactional updateMany with optimistic locking logic. The real
      // service (admission.service.ts allocateBed()) issues TWO updateMany
      // calls per request: step 1a releases any *other* bed already held by
      // this admission (a no-op here, since none is), and step 2 is the real
      // optimistic-lock allocation of `mockBed` itself -- only the latter
      // should ever flip `bedOccupied`, or the race this test exists to
      // exercise never actually happens (step 1a would "win" the race for
      // both concurrent requests before step 2 is ever reached).
      updateMany: jest.fn().mockImplementation(async ({ where }) => {
        const isAllocationStep = where?.id === mockBed.id;
        if (!isAllocationStep) {
          return { count: 0 };
        }
        if (bedOccupied) {
          return { count: 0 };
        }
        bedOccupied = true;
        return { count: 1 };
      }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
  };

  beforeAll(async () => {
    // Seed AdmissionDesk user
    const passwordHash = await bcrypt.hash('AdmissionPass123!', 10);
    usersStore.push({
      id: '00000000-0000-0000-0000-000000000098',
      identifier: 'admission@esic.gov.in',
      passwordHash,
      roleId: '00000000-0000-0000-0000-000000000002',
      active: true,
    });

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [{ identifier: 'admission@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID }],
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

    // Login Admission Desk User
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'admission@esic.gov.in', password: 'AdmissionPass123!' })
      .expect(200);

    admissionDeskToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should allow only ONE allocation request to succeed and reject concurrent duplicate with 409 Conflict', async () => {
    // Reset state
    bedOccupied = false;

    // Fire two concurrent bed allocation requests for the same bed simultaneously
    const payload = {
      bedId: mockBed.id,
      assignedDoctorId: '5c2e0b62-1279-4d69-a1b6-7f41bb92e6cc',
      assignedNurseId: '3f2a8936-e837-4d92-901c-d784a9e5257e',
    };

    const [response1, response2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/admissions/${mockAdmission.id}/allocate`)
        .set('Authorization', `Bearer ${admissionDeskToken}`)
        .send(payload),
      request(app.getHttpServer())
        .post(`/api/admissions/${mockAdmission.id}/allocate`)
        .set('Authorization', `Bearer ${admissionDeskToken}`)
        .send(payload),
    ]);

    const statuses = [response1.status, response2.status];
    if (!statuses.includes(201)) {
      console.log('RESPONSE 1 BODY:', response1.body);
      console.log('RESPONSE 2 BODY:', response2.body);
    }

    // Assert that exactly one succeeds (HTTP 201 Created) and one fails (HTTP 409 Conflict)
    expect(statuses).toContain(201);
    expect(statuses).toContain(409);

    expect(bedOccupied).toBe(true);
  });
});
