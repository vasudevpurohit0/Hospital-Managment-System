import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PlatformPrismaService } from '../src/common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../src/common/tenant/tenant-client-factory';
import * as bcrypt from 'bcryptjs';
import { createPlatformAuthMocks, E2E_TEST_HOSPITAL_ID } from './utils/platform-auth-mock';

describe('Security & Branding Module (E2E - Phase 15 Hardening)', () => {
  let app: INestApplication;
  let superadminToken: string;
  let doctorToken: string;

  const rolesStore: any[] = [
    { id: 'r-admin', name: 'SuperAdmin', isSystemRole: true },
    { id: 'r-doctor', name: 'Doctor', isSystemRole: true },
  ];
  const permissionsStore: any[] = [
    { id: 'p1', roleId: 'r-admin', resource: 'BrandingConfig', action: 'update' },
  ];
  const usersStore: any[] = [];

  let brandingRow = {
    id: 'singleton',
    hospitalName: 'ESIC Model Hospital & ODC',
    tagline: 'Chinta Se Mukti • Dedicated to Healthcare Excellence',
    primaryColor: '#005691',
    logoUrl: 'https://www.esic.gov.in/assets/images/logo.png',
  };

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
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    brandingConfig: {
      findUnique: jest.fn().mockImplementation(async () => brandingRow),
      upsert: jest.fn().mockImplementation(async ({ update }) => {
        brandingRow = { ...brandingRow, ...update };
        return brandingRow;
      }),
    },
  };

  beforeAll(async () => {
    const saHash = await bcrypt.hash('SuperAdminSecret123!', 10);
    usersStore.push({
      id: '00000000-0000-0000-0000-000000000010',
      identifier: 'superadmin@esic.gov.in',
      passwordHash: saHash,
      roleId: 'r-admin',
      active: true,
    });
    const docHash = await bcrypt.hash('DoctorPass123!', 10);
    usersStore.push({
      id: '00000000-0000-0000-0000-000000000011',
      identifier: 'doctor@esic.gov.in',
      passwordHash: docHash,
      roleId: 'r-doctor',
      active: true,
    });

    const { platformPrismaMock, tenantClientFactoryMock } = createPlatformAuthMocks(
      [
        { identifier: 'superadmin@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
        { identifier: 'doctor@esic.gov.in', hospitalId: E2E_TEST_HOSPITAL_ID },
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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    // Authenticate SuperAdmin
    const loginSuperAdmin = await request(app.getHttpServer()).post('/api/auth/login').send({
      identifier: 'superadmin@esic.gov.in',
      password: 'SuperAdminSecret123!',
    });
    superadminToken = loginSuperAdmin.body.accessToken || '';

    // Authenticate Doctor
    const loginDoctor = await request(app.getHttpServer()).post('/api/auth/login').send({
      identifier: 'doctor@esic.gov.in',
      password: 'DoctorPass123!',
    });
    doctorToken = loginDoctor.body.accessToken || '';
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Response Security Headers - Should carry HSTS, CSP, X-Frame-Options, X-Content-Type-Options headers (FR-SEC-09)', async () => {
    const res = await request(app.getHttpServer()).get('/api/branding').expect(200);

    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['content-security-policy']).toBe("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    // V-14: the self-issued, self-validated X-CSRF-Token was removed as
    // non-functional (Bearer-token auth was never actually protected by
    // it) -- confirmed gone, not just unasserted.
    expect(res.headers['x-csrf-token']).toBeUndefined();
  });

  it('2. GET /api/branding - Public read of hospital branding config', async () => {
    const res = await request(app.getHttpServer()).get('/api/branding').expect(200);

    expect(res.body.hospitalName).toBeDefined();
    expect(res.body.tagline).toBeDefined();
  });

  it('3. PUT /api/branding - SuperAdmin CAN update branding config (FR-CFG-01)', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/branding')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        hospitalName: 'ESIC Model Hospital & ODC (Hardened)',
        tagline: 'Chinta Se Mukti • Cyber Security Certified',
      })
      .expect(200);

    expect(res.body.status).toBe('success');
    expect(res.body.data.hospitalName).toContain('Hardened');
  });

  it('4. RBAC Cross-Role Restriction - Doctor CANNOT update branding config (Returns 403 Forbidden)', async () => {
    await request(app.getHttpServer())
      .put('/api/branding')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        hospitalName: 'Hacked Hospital',
      })
      .expect(403); // Forbidden by RBAC Guard
  });

  it('5. V-16 regression - a style-block-breakout primaryColor is rejected by the real HTTP validation pipe (400)', async () => {
    mockPrismaService.brandingConfig.upsert.mockClear();

    await request(app.getHttpServer())
      .put('/api/branding')
      .set('Authorization', `Bearer ${superadminToken}`)
      .send({
        primaryColor: "red } </style><script>alert(document.cookie)</script><style>",
      })
      .expect(400);

    // The malicious payload never made it into brandingConfig.upsert().
    expect(mockPrismaService.brandingConfig.upsert).not.toHaveBeenCalled();
  });
});
