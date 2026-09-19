import { Test, TestingModule } from '@nestjs/testing';
import { HospitalsService } from './hospitals.service';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { TenantUserProvisioningService } from '../../common/tenant/tenant-user-provisioning.service';

describe('HospitalsService (regression: platform-level administrative actions were never audit-logged)', () => {
  let service: HospitalsService;

  const mockPlatformPrisma = {
    hospital: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    loginIdentifier: { deleteMany: jest.fn() },
    platformAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HospitalsService,
        { provide: PlatformPrismaService, useValue: mockPlatformPrisma },
        { provide: TenantClientFactory, useValue: { getClient: jest.fn() } },
        { provide: TenantUserProvisioningService, useValue: {} },
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
    mockPlatformPrisma.hospital.findUnique.mockResolvedValue({ id: 'h-1', status: 'ACTIVE', schemaName: 'hospital_x' });
    const mockTenantClient = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u-1', identifier: 'nurse@hospital-x.example.com' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HospitalsService,
        { provide: PlatformPrismaService, useValue: mockPlatformPrisma },
        { provide: TenantClientFactory, useValue: { getClient: jest.fn().mockResolvedValue(mockTenantClient) } },
        { provide: TenantUserProvisioningService, useValue: {} },
      ],
    }).compile();
    service = module.get<HospitalsService>(HospitalsService);

    await service.resetHospitalUserPassword(
      'h-1',
      { identifier: 'Nurse@Hospital-X.example.com', newPassword: 'SuperSecretPlaintext123!' },
      'platform-user-1',
    );

    const call = mockPlatformPrisma.platformAuditLog.create.mock.calls[0][0];
    expect(JSON.stringify(call)).not.toContain('SuperSecretPlaintext123!');
    expect(call.data.metadata).toEqual({ identifier: 'nurse@hospital-x.example.com' });
  });
});
