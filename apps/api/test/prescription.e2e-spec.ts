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

describe('Digital Prescription & Doctor Immutability (e2e)', () => {
  let app: INestApplication;
  let doctorToken: string;
  let receptionToken: string;

  const rolesStore: any[] = [
    { id: 'r-doctor', name: 'Doctor', isSystemRole: true },
    { id: 'r-reception', name: 'Reception', isSystemRole: true },
  ];

  const permissionsStore: any[] = [
    { id: 'p1', roleId: 'r-doctor', resource: 'Employee', action: 'read' },
    { id: 'p2', roleId: 'r-doctor', resource: 'Prescription', action: 'create' },
    { id: 'p3', roleId: 'r-doctor', resource: 'Prescription', action: 'update' },
    { id: 'p4', roleId: 'r-doctor', resource: 'Prescription', action: 'sign' },
    { id: 'p5', roleId: 'r-reception', resource: 'Employee', action: 'read' },
    { id: 'p6', roleId: 'r-reception', resource: 'Prescription', action: 'create' },
  ];

  const usersStore: any[] = [];
  const prescriptionsStore: any[] = [];

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrismaService)),
    $queryRaw: jest.fn().mockResolvedValue([{ last_value: 1 }]),
    visit: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => ({ id: where.id, employeeId: 'emp-1', type: 'OPD', status: 'OPEN' })),
    },
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
    diagnosis: {
      create: jest.fn().mockResolvedValue({ id: 'dx-101', admissionRecommended: true }),
      findFirst: jest.fn().mockResolvedValue({ id: 'dx-101', admissionRecommended: true }),
    },
    prescription: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        const item = {
          // Real Postgres issues a UUID for Prescription.id (`@db.Uuid` in
          // prisma/schema.prisma); this id flows into `PUT /prescriptions/:id`
          // and `/:id/sign`, which now run through `ParseUUIDPipe`.
          id: randomUUID(),
          status: 'DRAFT',
          signedAt: null,
          items: [],
          ...data,
        };
        prescriptionsStore.push(item);
        return item;
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        return prescriptionsStore.find((p) => p.id === where?.id) || null;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const p = prescriptionsStore.find((rx) => rx.id === where?.id);
        if (p) {
          Object.assign(p, data);
        }
        return p;
      }),
    },
    labOrder: {
      create: jest.fn().mockResolvedValue({ id: 'lab-1' }),
    },
    admission: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'adm-stub-1', status: 'REQUESTED' }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  beforeAll(async () => {
    const docHash = await bcrypt.hash('DoctorPass123!', 10);
    const recHash = await bcrypt.hash('ReceptionPass123!', 10);

    usersStore.push({
      id: '00000000-0000-0000-0000-000000000088',
      identifier: 'doctor@esic.gov.in',
      passwordHash: docHash,
      roleId: 'r-doctor',
      active: true,
    });

    usersStore.push({
      id: '00000000-0000-0000-0000-000000000099',
      identifier: 'reception@esic.gov.in',
      passwordHash: recHash,
      roleId: 'r-reception',
      active: true,
    });

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [
        { identifier: 'doctor@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
        { identifier: 'reception@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
      ],
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

    const docLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'doctor@esic.gov.in', password: 'DoctorPass123!' })
      .expect(200);

    doctorToken = docLogin.body.accessToken;

    const recLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'reception@esic.gov.in', password: 'ReceptionPass123!' })
      .expect(200);

    receptionToken = recLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  let createdRxId: string;

  describe('1. Draft Prescription Creation', () => {
    it('should allow Doctor to create a Draft Prescription', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          visitId: '99999999-9999-4999-8999-999999999999',
          diagnosisText: 'Acute Bronchitis',
          admissionRecommended: true,
          items: [
            { medicineName: 'Paracetamol', dose: '500mg', frequency: '1-0-1', duration: '5 days' },
          ],
        })
        .expect(201);

      expect(res.body.prescription).toBeDefined();
      expect(res.body.prescription.status).toBe('DRAFT');
      createdRxId = res.body.prescription.id;
    });
  });

  describe('2. Non-Doctor Signing Restriction (FR-DOC-07)', () => {
    it('should reject non-doctor (Receptionist) attempting to sign with HTTP 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .post(`/api/prescriptions/${createdRxId}/sign`)
        .set('Authorization', `Bearer ${receptionToken}`)
        .expect(403);
    });
  });

  describe('3. Doctor Signing & Post-Signing Immutability Lock', () => {
    it('should allow Doctor role to sign prescription', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/prescriptions/${createdRxId}/sign`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(201);

      expect(res.body.status).toBe('SIGNED');
      expect(res.body.signedAt).toBeDefined();
    });

    it('should reject editing a SIGNED prescription at the API level with HTTP 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .put(`/api/prescriptions/${createdRxId}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          items: [{ medicineName: 'Ibuprofen', dose: '200mg', frequency: '1-1-1', duration: '3 days' }],
        })
        .expect(403);
    });
  });
});
