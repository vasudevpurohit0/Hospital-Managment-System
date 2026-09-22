import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { HospitalAdminsService } from './hospital-admins.service';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { TenantUserProvisioningService } from '../../common/tenant/tenant-user-provisioning.service';
import { LoginDirectoryService } from '../../common/tenant/login-directory.service';
import { AuthService } from '../auth/auth.service';

describe('HospitalAdminsService.impersonate (regression: Super Admin -> Hospital Admin impersonation had no reachable route)', () => {
  let service: HospitalAdminsService;

  const mockPlatformPrisma = {
    hospital: { findUnique: jest.fn() },
  };

  const mockTenantClient = {
    user: { findUnique: jest.fn() },
  };

  const mockTenantClients = {
    getClient: jest.fn().mockResolvedValue(mockTenantClient),
  };

  const mockLoginDirectory = {
    checkLock: jest.fn().mockResolvedValue(undefined),
  };

  const mockAuthService = {
    issueImpersonationSession: jest.fn().mockResolvedValue({
      accessToken: 'impersonation-token',
      expiresIn: '60m',
      sessionId: 'session-1',
    }),
  };

  const activeAdminTarget = {
    id: 'admin-1',
    identifier: 'admin@hospital-a.esic.gov.in',
    roleId: 'role-admin',
    tokenVersion: 0,
    active: true,
    mustChangePassword: false,
    role: { name: 'Administrator' },
    employee: { name: 'Hospital A Admin' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HospitalAdminsService,
        { provide: PlatformPrismaService, useValue: mockPlatformPrisma },
        { provide: TenantClientFactory, useValue: mockTenantClients },
        { provide: TenantUserProvisioningService, useValue: {} },
        { provide: LoginDirectoryService, useValue: mockLoginDirectory },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    service = module.get<HospitalAdminsService>(HospitalAdminsService);
    jest.clearAllMocks();
    mockPlatformPrisma.hospital.findUnique.mockResolvedValue({
      id: 'hosp-a',
      status: 'ACTIVE',
      schemaName: 'hospital_a',
      name: 'Hospital A',
    });
    mockLoginDirectory.checkLock.mockResolvedValue(undefined);
  });

  it('starts an impersonation session for an active Administrator, tagging the impersonator as a Super Admin', async () => {
    mockTenantClient.user.findUnique.mockResolvedValue(activeAdminTarget);

    const result = await service.impersonate('hosp-a', 'admin-1', { id: 'platform-1', identifier: 'super@platform.local' });

    expect(mockAuthService.issueImpersonationSession).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ id: 'admin-1', roleName: 'Administrator' }),
        hospitalId: 'hosp-a',
        schemaName: 'hospital_a',
        impersonator: expect.objectContaining({ id: 'platform-1', type: 'platform' }),
      }),
    );
    expect(result.accessToken).toBe('impersonation-token');
    expect(result.target).toEqual({ id: 'admin-1', identifier: activeAdminTarget.identifier, role: 'Administrator', name: 'Hospital A Admin' });
  });

  it('rejects impersonating a user id that does not resolve to an Administrator in this hospital (404, not a generic failure)', async () => {
    mockTenantClient.user.findUnique.mockResolvedValue(null);

    await expect(
      service.impersonate('hosp-a', 'nonexistent', { id: 'platform-1', identifier: 'super@platform.local' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects impersonating a deactivated Administrator', async () => {
    mockTenantClient.user.findUnique.mockResolvedValue({ ...activeAdminTarget, active: false });

    await expect(
      service.impersonate('hosp-a', 'admin-1', { id: 'platform-1', identifier: 'super@platform.local' }),
    ).rejects.toThrow(BadRequestException);
    expect(mockAuthService.issueImpersonationSession).not.toHaveBeenCalled();
  });

  it('rejects impersonating an Administrator still mid first-login password setup', async () => {
    mockTenantClient.user.findUnique.mockResolvedValue({ ...activeAdminTarget, mustChangePassword: true });

    await expect(
      service.impersonate('hosp-a', 'admin-1', { id: 'platform-1', identifier: 'super@platform.local' }),
    ).rejects.toThrow(BadRequestException);
    expect(mockAuthService.issueImpersonationSession).not.toHaveBeenCalled();
  });

  it('rejects impersonating a locked Administrator', async () => {
    mockTenantClient.user.findUnique.mockResolvedValue(activeAdminTarget);
    mockLoginDirectory.checkLock.mockRejectedValue(new ForbiddenException('Account locked'));

    await expect(
      service.impersonate('hosp-a', 'admin-1', { id: 'platform-1', identifier: 'super@platform.local' }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockAuthService.issueImpersonationSession).not.toHaveBeenCalled();
  });

  it('rejects targeting a hospital that is still provisioning (no tenant schema to look the user up in yet)', async () => {
    mockPlatformPrisma.hospital.findUnique.mockResolvedValue({ id: 'hosp-a', status: 'PROVISIONING' });

    await expect(
      service.impersonate('hosp-a', 'admin-1', { id: 'platform-1', identifier: 'super@platform.local' }),
    ).rejects.toThrow(BadRequestException);
  });
});
