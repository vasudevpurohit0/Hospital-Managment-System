import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { HospitalsService } from './hospitals.service';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { TenantMigrationService } from '../../common/tenant/tenant-migration.service';
import { TenantUserProvisioningService } from '../../common/tenant/tenant-user-provisioning.service';
import { StaffService } from '../user/staff.service';

describe('HospitalsService (regression: platform-level administrative actions were never audit-logged)', () => {
  let service: HospitalsService;

  const mockPlatformPrisma = {
    hospital: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    loginIdentifier: { deleteMany: jest.fn() },
    platformAuditLog: { create: jest.fn().mockResolvedValue({}) },
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HospitalsService,
        { provide: PlatformPrismaService, useValue: mockPlatformPrisma },
        { provide: TenantClientFactory, useValue: { getClient: jest.fn() } },
        { provide: TenantUserProvisioningService, useValue: {} },
        { provide: StaffService, useValue: {} },
      ],
    }).compile();

    service = module.get<HospitalsService>(HospitalsService);
    jest.clearAllMocks();
  });

  it('writes a PlatformAuditLog entry when a hospital is updated', async () => {
    mockPlatformPrisma.hospital.findUnique.mockResolvedValue({ id: 'h-1', status: 'ACTIVE' });
    mockPlatformPrisma.hospital.update.mockResolvedValue({ id: 'h-1', name: 'New Name' });

    await service.update('h-1', { name: 'New Name' }, 'platform-user-1');

    expect(mockPlatformPrisma.platformAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        platformUserId: 'platform-user-1',
        action: 'hospital.update',
        hospitalId: 'h-1',
        resource: 'Hospital',
      }),
    });
  });

  it('writes a PlatformAuditLog entry when a hospital is suspended, recording the status transition', async () => {
    mockPlatformPrisma.hospital.findUnique.mockResolvedValue({ id: 'h-1', status: 'ACTIVE' });
    mockPlatformPrisma.hospital.update.mockResolvedValue({ id: 'h-1', status: 'SUSPENDED' });

    await service.setStatus('h-1', { status: 'SUSPENDED' as any }, 'platform-user-1');

    expect(mockPlatformPrisma.platformAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        platformUserId: 'platform-user-1',
        action: 'hospital.set_status',
        hospitalId: 'h-1',
        metadata: { from: 'ACTIVE', to: 'SUSPENDED' },
      }),
    });
  });

  it('never records the new password value when logging a password-reset action', async () => {
    mockPlatformPrisma.hospital.findUnique.mockResolvedValue({
      id: 'h-1',
      status: 'ACTIVE',
      schemaName: 'hospital_x',
    });
    const mockTenantClient = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'u-1', identifier: 'nurse@hospital-x.example.com' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HospitalsService,
        { provide: PlatformPrismaService, useValue: mockPlatformPrisma },
        {
          provide: TenantClientFactory,
          useValue: { getClient: jest.fn().mockResolvedValue(mockTenantClient) },
        },
        { provide: TenantUserProvisioningService, useValue: {} },
        { provide: StaffService, useValue: {} },
      ],
    }).compile();
    service = module.get<HospitalsService>(HospitalsService);

    await service.resetHospitalUserPassword(
      'h-1',
      {
        identifier: 'Nurse@Hospital-X.example.com',
        newPassword: 'SuperSecretPlaintext123!',
        confirmPassword: 'SuperSecretPlaintext123!',
      },
      'platform-user-1',
    );

    const call = mockPlatformPrisma.platformAuditLog.create.mock.calls[0][0];
    expect(JSON.stringify(call)).not.toContain('SuperSecretPlaintext123!');
    expect(call.data.metadata).toEqual({ identifier: 'nurse@hospital-x.example.com' });
  });
});

describe('HospitalsService.resetAllHospitalUserPasswords (bulk onboarding-password reset)', () => {
  let service: HospitalsService;

  const mockPlatformPrisma = {
    hospital: { findUnique: jest.fn() },
    platformAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const mockTenantClient = {
    user: {
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HospitalsService,
        { provide: PlatformPrismaService, useValue: mockPlatformPrisma },
        {
          provide: TenantClientFactory,
          useValue: { getClient: jest.fn().mockResolvedValue(mockTenantClient) },
        },
        { provide: TenantUserProvisioningService, useValue: {} },
        { provide: StaffService, useValue: {} },
      ],
    }).compile();

    service = module.get<HospitalsService>(HospitalsService);
    jest.clearAllMocks();
    mockPlatformPrisma.hospital.findUnique.mockResolvedValue({
      id: 'h-1',
      name: 'Hospital A',
      schemaName: 'hospital_a',
    });
  });

  it('rejects a mismatched confirmation without touching any user', async () => {
    await expect(
      service.resetAllHospitalUserPasswords(
        'h-1',
        { newPassword: 'Temporary@123', confirmPassword: 'Different@123' },
        'platform-1',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(mockTenantClient.user.findMany).not.toHaveBeenCalled();
  });

  it('resets every ACTIVE user only, forcing a password change and invalidating existing sessions', async () => {
    mockTenantClient.user.findMany.mockResolvedValue([
      { id: 'u-1', identifier: 'nurse@hospital-a.esic.gov.in' },
      { id: 'u-2', identifier: 'admin@hospital-a.esic.gov.in' },
    ]);

    const result = await service.resetAllHospitalUserPasswords(
      'h-1',
      { newPassword: 'Temporary@123', confirmPassword: 'Temporary@123' },
      'platform-1',
    );

    // Only active users were ever looked up -- a deactivated account is
    // never silently reactivated by this operation.
    expect(mockTenantClient.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
    expect(mockTenantClient.user.update).toHaveBeenCalledTimes(2);
    for (const call of mockTenantClient.user.update.mock.calls) {
      expect(call[0].data).toEqual(
        expect.objectContaining({ mustChangePassword: true, tokenVersion: { increment: 1 } }),
      );
    }
    expect(result).toEqual({
      reset: true,
      affectedCount: 2,
      identifiers: ['nurse@hospital-a.esic.gov.in', 'admin@hospital-a.esic.gov.in'],
    });
  });

  it('never records the new password value in the audit log', async () => {
    mockTenantClient.user.findMany.mockResolvedValue([
      { id: 'u-1', identifier: 'nurse@hospital-a.esic.gov.in' },
    ]);

    await service.resetAllHospitalUserPasswords(
      'h-1',
      { newPassword: 'SuperSecretPlaintext123!', confirmPassword: 'SuperSecretPlaintext123!' },
      'platform-1',
    );

    const call = mockPlatformPrisma.platformAuditLog.create.mock.calls[0][0];
    expect(JSON.stringify(call)).not.toContain('SuperSecretPlaintext123!');
    expect(call.data.action).toBe('hospital.reset_all_user_passwords');
  });
});

describe('HospitalsService.createHospital (auto-created role roster, minus Doctor)', () => {
  let service: HospitalsService;

  const mockPlatformPrisma = {
    hospital: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    platformAuditLog: { create: jest.fn().mockResolvedValue({}) },
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
  };

  const mockUserProvisioning = {
    registerSeededIdentifiers: jest.fn().mockResolvedValue(undefined),
    provisionAdministrator: jest
      .fn()
      .mockResolvedValue({ id: 'admin-1', identifier: 'admin@h.esic.gov.in' }),
  };
  const mockStaffService = {
    createDefaultRoleAccounts: jest
      .fn()
      .mockResolvedValue({
        created: [],
        skipped: [],
        failed: [],
        createdCount: 0,
        skippedCount: 0,
        failedCount: 0,
      }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HospitalsService,
        { provide: PlatformPrismaService, useValue: mockPlatformPrisma },
        { provide: TenantClientFactory, useValue: { getClient: jest.fn().mockResolvedValue({}) } },
        { provide: TenantUserProvisioningService, useValue: mockUserProvisioning },
        { provide: StaffService, useValue: mockStaffService },
      ],
    }).compile();

    service = module.get<HospitalsService>(HospitalsService);
    jest.clearAllMocks();
    mockPlatformPrisma.hospital.findUnique.mockResolvedValue(null);
    mockPlatformPrisma.hospital.create.mockResolvedValue({
      id: 'h-new',
      slug: 'new-hospital',
      schemaName: 'hospital_new_hospital',
    });
    mockPlatformPrisma.hospital.update.mockResolvedValue({ id: 'h-new', status: 'ACTIVE' });
    mockUserProvisioning.registerSeededIdentifiers.mockResolvedValue(undefined);
    mockUserProvisioning.provisionAdministrator.mockResolvedValue({
      id: 'admin-1',
      identifier: 'admin@h.esic.gov.in',
    });
    mockStaffService.createDefaultRoleAccounts.mockResolvedValue({
      created: [],
      skipped: [],
      failed: [],
      createdCount: 0,
      skippedCount: 0,
      failedCount: 0,
    });
    // Both shell out to the real Prisma CLI in the real implementation --
    // never something a unit test should actually invoke.
    jest.spyOn(service as any, 'runMigrateDeploy').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'runSeed').mockResolvedValue(undefined);
  });

  it('auto-creates the default role roster excluding Doctor, sharing the initial password', async () => {
    await service.createHospital(
      {
        name: 'New Hospital',
        slug: 'new-hospital',
        adminIdentifier: 'admin@h.esic.gov.in',
        initialPassword: 'Temporary@123',
        confirmPassword: 'Temporary@123',
      } as any,
      'platform-1',
    );

    expect(mockStaffService.createDefaultRoleAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPassword: 'Temporary@123',
        confirmPassword: 'Temporary@123',
        requirePasswordChange: true,
      }),
      expect.objectContaining({ type: 'platform' }),
    );
    const [dto] = mockStaffService.createDefaultRoleAccounts.mock.calls[0];
    expect(dto.roles).not.toContain('Doctor');
    expect(dto.roles.length).toBeGreaterThan(0);
  });

  it('rolls back the schema and platform-DB row if auto-creating the role roster fails', async () => {
    mockStaffService.createDefaultRoleAccounts.mockRejectedValue(new Error('boom'));

    await expect(
      service.createHospital(
        {
          name: 'New Hospital',
          slug: 'new-hospital',
          adminIdentifier: 'admin@h.esic.gov.in',
          initialPassword: 'Temporary@123',
          confirmPassword: 'Temporary@123',
        } as any,
        'platform-1',
      ),
    ).rejects.toThrow();

    expect(mockPlatformPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('DROP SCHEMA IF EXISTS'),
    );
    expect(mockPlatformPrisma.hospital.delete).toHaveBeenCalledWith({ where: { id: 'h-new' } });
  });
});

describe('HospitalsService.remove (regression: F-30 — a hospital stuck in PROVISIONING had no recovery path)', () => {
  let service: HospitalsService;

  const mockPlatformPrisma = {
    hospital: {
      findUnique: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    loginIdentifier: { deleteMany: jest.fn().mockResolvedValue({}) },
    platformAuditLog: { create: jest.fn().mockResolvedValue({}) },
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HospitalsService,
        { provide: PlatformPrismaService, useValue: mockPlatformPrisma },
        { provide: TenantClientFactory, useValue: { getClient: jest.fn() } },
        { provide: TenantUserProvisioningService, useValue: {} },
        { provide: StaffService, useValue: {} },
      ],
    }).compile();

    service = module.get<HospitalsService>(HospitalsService);
    jest.clearAllMocks();
  });

  it('allows deleting a hospital stuck in PROVISIONING, dropping its schema and freeing its identifiers', async () => {
    mockPlatformPrisma.hospital.findUnique.mockResolvedValue({
      id: 'h-stuck',
      status: 'PROVISIONING',
      schemaName: 'hospital_stuck_one',
      name: 'Stuck One',
      slug: 'stuck-one',
    });

    const result = await service.remove('h-stuck', 'platform-user-1');

    expect(result).toEqual({ deleted: true });
    expect(mockPlatformPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('DROP SCHEMA IF EXISTS "hospital_stuck_one"'),
    );
    expect(mockPlatformPrisma.hospital.delete).toHaveBeenCalledWith({ where: { id: 'h-stuck' } });
  });

  it('still refuses to delete an ACTIVE hospital without suspending it first', async () => {
    mockPlatformPrisma.hospital.findUnique.mockResolvedValue({
      id: 'h-active',
      status: 'ACTIVE',
      schemaName: 'hospital_active_one',
    });

    await expect(service.remove('h-active', 'platform-user-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(mockPlatformPrisma.hospital.delete).not.toHaveBeenCalled();
  });

  it('still allows deleting an already-SUSPENDED hospital', async () => {
    mockPlatformPrisma.hospital.findUnique.mockResolvedValue({
      id: 'h-susp',
      status: 'SUSPENDED',
      schemaName: 'hospital_susp_one',
      name: 'Suspended One',
      slug: 'susp-one',
    });

    const result = await service.remove('h-susp', 'platform-user-1');

    expect(result).toEqual({ deleted: true });
    expect(mockPlatformPrisma.hospital.delete).toHaveBeenCalledWith({ where: { id: 'h-susp' } });
  });
});
