import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantUserProvisioningService } from './tenant-user-provisioning.service';
import { TenantClientFactory } from './tenant-client-factory';
import { LoginDirectoryService } from './login-directory.service';

describe('TenantUserProvisioningService (regression: identifier case-mismatch lockout)', () => {
  let service: TenantUserProvisioningService;

  const mockTenantClient = {
    role: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'role-admin' }) },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'user-1', identifier: data.identifier })),
      update: jest
        .fn()
        .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
    },
  };

  const mockTenantClients = {
    getClient: jest.fn().mockResolvedValue(mockTenantClient),
  };

  const mockLoginDirectory = {
    register: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn().mockResolvedValue(null),
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

  it('forces a password change on first login, matching every Staff/Doctor account (regression: this used to default to false, letting Administrators skip forced first-login setup)', async () => {
    await service.provisionAdministrator('hospital_test', 'hosp-1', 'admin@hospital.com', 'password123');

    expect(mockTenantClient.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mustChangePassword: true }) }),
    );
  });

  it('rolls back the (normalized) directory registration if the tenant-side create fails', async () => {
    mockTenantClient.user.create.mockRejectedValueOnce(new Error('tenant create failed'));

    await expect(
      service.provisionAdministrator('hospital_test', 'hosp-1', 'Admin@Hospital.com', 'password123'),
    ).rejects.toThrow('tenant create failed');

    expect(mockLoginDirectory.remove).toHaveBeenCalledWith('admin@hospital.com');
  });

  it('rolls back only a registration this call created -- a resume-path failure keeps the pre-existing row', async () => {
    mockLoginDirectory.register.mockRejectedValueOnce(new ConflictException('taken'));
    mockLoginDirectory.resolve.mockResolvedValueOnce({ hospitalId: 'hosp-1' });
    mockTenantClient.user.findUnique.mockResolvedValueOnce(null);
    mockTenantClient.user.create.mockRejectedValueOnce(new Error('tenant create failed'));

    await expect(
      service.provisionAdministrator('hospital_test', 'hosp-1', 'admin@hospital.com', 'pw', {
        idempotentResume: true,
      }),
    ).rejects.toThrow('tenant create failed');

    expect(mockLoginDirectory.remove).not.toHaveBeenCalled();
  });
});

describe('TenantUserProvisioningService.provisionAdministrator idempotentResume (regression: a failed onboarding left directory rows that bricked every retry with "already registered")', () => {
  let service: TenantUserProvisioningService;

  const mockTenantClient = {
    role: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'role-admin' }) },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: 'user-1', identifier: data.identifier })),
      update: jest
        .fn()
        .mockImplementation(({ where }) => Promise.resolve({ id: where.id, identifier: 'admin@hospital.com' })),
    },
  };

  const mockLoginDirectory = {
    register: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn().mockResolvedValue(null),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantUserProvisioningService,
        { provide: TenantClientFactory, useValue: { getClient: jest.fn().mockResolvedValue(mockTenantClient) } },
        { provide: LoginDirectoryService, useValue: mockLoginDirectory },
      ],
    }).compile();

    service = module.get<TenantUserProvisioningService>(TenantUserProvisioningService);
    jest.clearAllMocks();
  });

  it('reuses a same-hospital directory registration and the existing admin user, refreshing to the retried password', async () => {
    mockLoginDirectory.register.mockRejectedValueOnce(new ConflictException('taken'));
    mockLoginDirectory.resolve.mockResolvedValueOnce({ hospitalId: 'hosp-1' });
    mockTenantClient.user.findUnique.mockResolvedValueOnce({
      id: 'user-9',
      identifier: 'admin@hospital.com',
      roleId: 'role-admin',
    });

    const result = await service.provisionAdministrator(
      'hospital_test',
      'hosp-1',
      'admin@hospital.com',
      'new-password',
      { idempotentResume: true },
    );

    expect(result).toEqual({ id: 'user-9', identifier: 'admin@hospital.com' });
    expect(mockTenantClient.user.create).not.toHaveBeenCalled();
    expect(mockTenantClient.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-9' } }),
    );
    expect(mockLoginDirectory.remove).not.toHaveBeenCalled();
  });

  it('creates the tenant user when the directory row exists but the tenant user does not', async () => {
    mockLoginDirectory.register.mockRejectedValueOnce(new ConflictException('taken'));
    mockLoginDirectory.resolve.mockResolvedValueOnce({ hospitalId: 'hosp-1' });
    mockTenantClient.user.findUnique.mockResolvedValueOnce(null);

    const result = await service.provisionAdministrator(
      'hospital_test',
      'hosp-1',
      'admin@hospital.com',
      'password123',
      { idempotentResume: true },
    );

    expect(mockTenantClient.user.create).toHaveBeenCalled();
    expect(result.identifier).toBe('admin@hospital.com');
  });

  it('still rejects a conflict owned by another hospital', async () => {
    mockLoginDirectory.register.mockRejectedValueOnce(new ConflictException('taken'));
    mockLoginDirectory.resolve.mockResolvedValueOnce({ hospitalId: 'hosp-other' });

    await expect(
      service.provisionAdministrator('hospital_test', 'hosp-1', 'admin@hospital.com', 'pw', {
        idempotentResume: true,
      }),
    ).rejects.toThrow(ConflictException);
    expect(mockTenantClient.user.findUnique).not.toHaveBeenCalled();
    expect(mockTenantClient.user.create).not.toHaveBeenCalled();
  });

  it('still rejects an ownerless row (platform account or cleaned-up orphan)', async () => {
    mockLoginDirectory.register.mockRejectedValueOnce(new ConflictException('taken'));
    mockLoginDirectory.resolve.mockResolvedValueOnce({ hospitalId: null });

    await expect(
      service.provisionAdministrator('hospital_test', 'hosp-1', 'admin@hospital.com', 'pw', {
        idempotentResume: true,
      }),
    ).rejects.toThrow(ConflictException);
    expect(mockTenantClient.user.create).not.toHaveBeenCalled();
  });

  it('rejects when the occupying tenant user is not an Administrator', async () => {
    mockLoginDirectory.register.mockRejectedValueOnce(new ConflictException('taken'));
    mockLoginDirectory.resolve.mockResolvedValueOnce({ hospitalId: 'hosp-1' });
    mockTenantClient.user.findUnique.mockResolvedValueOnce({
      id: 'user-9',
      identifier: 'admin@hospital.com',
      roleId: 'role-other',
    });

    await expect(
      service.provisionAdministrator('hospital_test', 'hosp-1', 'admin@hospital.com', 'pw', {
        idempotentResume: true,
      }),
    ).rejects.toThrow('non-Administrator');
    expect(mockLoginDirectory.remove).not.toHaveBeenCalled();
  });

  it('without idempotentResume, even a same-hospital conflict stays a hard error (plain create semantics)', async () => {
    mockLoginDirectory.register.mockRejectedValueOnce(new ConflictException('taken'));

    await expect(
      service.provisionAdministrator('hospital_test', 'hosp-1', 'admin@hospital.com', 'pw'),
    ).rejects.toThrow(ConflictException);
    expect(mockLoginDirectory.resolve).not.toHaveBeenCalled();
    expect(mockTenantClient.user.findUnique).not.toHaveBeenCalled();
    expect(mockTenantClient.user.create).not.toHaveBeenCalled();
  });
});
