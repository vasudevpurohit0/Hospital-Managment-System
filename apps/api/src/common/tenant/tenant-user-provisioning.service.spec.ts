import { Test, TestingModule } from '@nestjs/testing';
import { TenantUserProvisioningService } from './tenant-user-provisioning.service';
import { TenantClientFactory } from './tenant-client-factory';
import { LoginDirectoryService } from './login-directory.service';

describe('TenantUserProvisioningService (regression: identifier case-mismatch lockout)', () => {
  let service: TenantUserProvisioningService;

  const mockTenantClient = {
    role: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'role-admin' }) },
    user: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'user-1', identifier: data.identifier })),
    },
  };

  const mockTenantClients = {
    getClient: jest.fn().mockResolvedValue(mockTenantClient),
  };

  const mockLoginDirectory = {
    register: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantUserProvisioningService,
        { provide: TenantClientFactory, useValue: mockTenantClients },
        { provide: LoginDirectoryService, useValue: mockLoginDirectory },
      ],
    }).compile();

    service = module.get<TenantUserProvisioningService>(TenantUserProvisioningService);
    jest.clearAllMocks();
  });

  it('stores the tenant User.identifier lowercased, matching what LoginDirectoryService stores for the directory row (regression: previously case was preserved, breaking login forever)', async () => {
    const result = await service.provisionAdministrator(
      'hospital_test',
      'hosp-1',
      'Admin@Hospital.Example.COM',
      'password123',
    );

    expect(mockLoginDirectory.register).toHaveBeenCalledWith('admin@hospital.example.com', 'hosp-1');
    expect(mockTenantClient.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ identifier: 'admin@hospital.example.com' }),
      }),
    );
    expect(result.identifier).toBe('admin@hospital.example.com');
  });

  it('trims whitespace as well as lowercasing', async () => {
    await service.provisionAdministrator('hospital_test', 'hosp-1', '  Admin@Hospital.com  ', 'password123');

    expect(mockLoginDirectory.register).toHaveBeenCalledWith('admin@hospital.com', 'hosp-1');
    expect(mockTenantClient.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ identifier: 'admin@hospital.com' }) }),
    );
  });

  it('rolls back the (normalized) directory registration if the tenant-side create fails', async () => {
    mockTenantClient.user.create.mockRejectedValueOnce(new Error('tenant create failed'));

    await expect(
      service.provisionAdministrator('hospital_test', 'hosp-1', 'Admin@Hospital.com', 'password123'),
    ).rejects.toThrow('tenant create failed');

    expect(mockLoginDirectory.remove).toHaveBeenCalledWith('admin@hospital.com');
  });
});
