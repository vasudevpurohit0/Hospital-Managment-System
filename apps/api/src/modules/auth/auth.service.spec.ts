import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { LoginDirectoryService } from '../../common/tenant/login-directory.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { EmailService } from '../../common/email/email.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockUser = {
    id: 'user-123',
    identifier: 'doctor@esic.gov.in',
    passwordHash: '',
    roleId: 'role-123',
    active: true,
    role: {
      name: 'Doctor',
      permissions: [
        { resource: 'Prescription', action: 'create' },
        { resource: 'Prescription', action: 'sign' },
      ],
    },
  };

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    loginActivity: {
      create: jest.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  };
  mockPrismaService.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockPrismaService));

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock_jwt_token'),
    verify: jest.fn(),
  };

  const mockHospital = {
    id: 'hospital-123',
    slug: 'test-hospital',
    schemaName: 'hospital_test_hospital',
    status: 'ACTIVE',
  };

  const mockPlatformPrismaService = {
    hospital: {
      findUnique: jest.fn().mockResolvedValue(mockHospital),
    },
    passwordResetToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    activationToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  const mockEmailService = {
    sendMail: jest.fn().mockResolvedValue(undefined),
  };

  const mockTenantClientFactory = {
    getClient: jest.fn().mockResolvedValue(mockPrismaService),
  };

  const mockLoginDirectoryService = {
    checkLock: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn().mockResolvedValue({ hospitalId: 'hospital-123' }),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    mockUser.passwordHash = await bcrypt.hash('DoctorPass123!', 10);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: PlatformPrismaService, useValue: mockPlatformPrismaService },
        { provide: TenantClientFactory, useValue: mockTenantClientFactory },
        { provide: LoginDirectoryService, useValue: mockLoginDirectoryService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser()', () => {
    it('should validate and return user for correct password', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.validateUser('doctor@esic.gov.in', 'DoctorPass123!');
      expect(result).toBeDefined();
      expect(result.id).toBe('user-123');
    });

    it('should throw UnauthorizedException for incorrect password', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.validateUser('doctor@esic.gov.in', 'WrongPassword')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw ServiceUnavailableException when database query fails', async () => {
      mockPrismaService.user.findUnique.mockRejectedValue(new Error('Connection lost'));

      await expect(service.validateUser('doctor@esic.gov.in', 'DoctorPass123!')).rejects.toThrow(
        'Database service is currently unavailable.',
      );
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.validateUser('nonexistent@esic.gov.in', 'DoctorPass123!')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for inactive user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        active: false,
      });

      await expect(service.validateUser('doctor@esic.gov.in', 'DoctorPass123!')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a temporary password that has expired, with a distinct message from a bad password', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        mustChangePassword: true,
        tempPasswordExpiresAt: new Date(Date.now() - 60_000),
      });

      await expect(service.validateUser('doctor@esic.gov.in', 'DoctorPass123!')).rejects.toThrow(
        /temporary password has expired/,
      );
    });

    it('allows login on an unexpired temporary password', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        mustChangePassword: true,
        tempPasswordExpiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.validateUser('doctor@esic.gov.in', 'DoctorPass123!');
      expect(result.id).toBe('user-123');
    });
  });

  describe('login()', () => {
    it('should issue accessToken and refreshToken on successful login', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.login({
        identifier: 'doctor@esic.gov.in',
        password: 'DoctorPass123!',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.mode).toBe('hospital');
      if (result.mode !== 'hospital') throw new Error('expected a hospital-mode login result');
      expect(result.user.role).toBe('Doctor');
    });
  });

  describe('changePassword()', () => {
    const authedDoctor: AuthenticatedUser = {
      id: 'user-123',
      identifier: 'doctor@esic.gov.in',
      roleId: 'role-123',
      roleName: 'Doctor',
      permissions: [],
      type: 'hospital',
      mustChangePassword: true,
    };

    it('rejects a platform (Super Admin) caller -- self-service change is hospital-staff only', async () => {
      await expect(
        service.changePassword({ ...authedDoctor, type: 'platform' }, { currentPassword: 'x', newPassword: 'y' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an incorrect current password', async () => {
      mockPrismaService.user.findUniqueOrThrow.mockResolvedValue(mockUser);
      await expect(
        service.changePassword(authedDoctor, { currentPassword: 'WrongPassword', newPassword: 'NewSecure123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('updates the password hash and clears mustChangePassword on success', async () => {
      mockPrismaService.user.findUniqueOrThrow.mockResolvedValue(mockUser);
      const result = await service.changePassword(authedDoctor, {
        currentPassword: 'DoctorPass123!',
        newPassword: 'NewSecure123!',
      });

      expect(result.status).toBe('success');
      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-123' },
          data: expect.objectContaining({ mustChangePassword: false, tokenVersion: { increment: 1 } }),
        }),
      );
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'auth.password_changed' }) }),
      );
    });
  });

  describe('forgotPassword()', () => {
    it('returns the same generic message for an unknown identifier -- never confirms account existence', async () => {
      mockLoginDirectoryService.resolve.mockResolvedValueOnce(null);
      const result = await service.forgotPassword({ identifier: 'nobody@esic.gov.in' });
      expect(result.status).toBe('success');
      expect(mockPlatformPrismaService.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('creates a hashed, expiring token for a resolvable hospital identifier -- the raw token is never persisted', async () => {
      mockLoginDirectoryService.resolve.mockResolvedValueOnce({ hospitalId: 'hospital-123' });
      const result = await service.forgotPassword({ identifier: 'doctor@esic.gov.in' });

      expect(result.status).toBe('success');
      expect(mockPlatformPrismaService.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const createArgs = mockPlatformPrismaService.passwordResetToken.create.mock.calls[0][0];
      expect(createArgs.data.tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex, never the raw token
    });

    it('returns the identical generic message in both the known and unknown case', async () => {
      mockLoginDirectoryService.resolve.mockResolvedValueOnce(null);
      const unknown = await service.forgotPassword({ identifier: 'nobody@esic.gov.in' });
      mockLoginDirectoryService.resolve.mockResolvedValueOnce({ hospitalId: 'hospital-123' });
      const known = await service.forgotPassword({ identifier: 'doctor@esic.gov.in' });
      expect(unknown.message).toBe(known.message);
    });
  });

  describe('resetPasswordWithToken()', () => {
    it('rejects an unknown token', async () => {
      mockPlatformPrismaService.passwordResetToken.findUnique.mockResolvedValue(null);
      await expect(
        service.resetPasswordWithToken({ token: 'bogus', newPassword: 'NewSecure123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      mockPlatformPrismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: 'reset-1',
        identifier: 'doctor@esic.gov.in',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        service.resetPasswordWithToken({ token: 'expired', newPassword: 'NewSecure123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an already-used token -- single-use enforced', async () => {
      mockPlatformPrismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: 'reset-1',
        identifier: 'doctor@esic.gov.in',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(
        service.resetPasswordWithToken({ token: 'used', newPassword: 'NewSecure123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('updates the password and marks the token used on a valid token', async () => {
      mockPlatformPrismaService.passwordResetToken.findUnique.mockResolvedValue({
        id: 'reset-1',
        identifier: 'doctor@esic.gov.in',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      mockLoginDirectoryService.resolve.mockResolvedValueOnce({ hospitalId: 'hospital-123' });
      mockPrismaService.user.findUniqueOrThrow.mockResolvedValue(mockUser);

      await service.resetPasswordWithToken({ token: 'valid-token', newPassword: 'NewSecure123!' });

      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ mustChangePassword: false }) }),
      );
      expect(mockPlatformPrismaService.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'reset-1' },
        data: { usedAt: expect.any(Date) },
      });
    });
  });

  describe('sendActivationEmail()', () => {
    it('invalidates any previously-outstanding unused token before issuing a new one', async () => {
      await service.sendActivationEmail({
        identifier: 'New.Nurse@ESIC.gov.in',
        staffName: 'New Nurse',
        staffId: 'NUR-0001',
        role: 'Nurse',
        hospitalId: 'hospital-123',
      });

      expect(mockPlatformPrismaService.activationToken.updateMany).toHaveBeenCalledWith({
        where: { identifier: 'new.nurse@esic.gov.in', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
      expect(mockPlatformPrismaService.activationToken.create).toHaveBeenCalledTimes(1);
    });

    it('sends the activation email with a link and never includes a password', async () => {
      await service.sendActivationEmail({
        identifier: 'new.nurse@esic.gov.in',
        staffName: 'New Nurse',
        staffId: 'NUR-0001',
        role: 'Nurse',
        hospitalId: 'hospital-123',
      });

      expect(mockEmailService.sendMail).toHaveBeenCalledTimes(1);
      const call = mockEmailService.sendMail.mock.calls[0][0];
      expect(call.to).toBe('new.nurse@esic.gov.in');
      expect(call.kind).toBe('ACTIVATION');
      expect(call.html).toContain('/activate?token=');
      expect(call.html.toLowerCase()).not.toContain('password');
    });
  });

  describe('activateAccount()', () => {
    it('rejects an unknown token', async () => {
      mockPlatformPrismaService.activationToken.findUnique.mockResolvedValue(null);
      await expect(service.activateAccount({ token: 'bogus', newPassword: 'NewSecure123!' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired token', async () => {
      mockPlatformPrismaService.activationToken.findUnique.mockResolvedValue({
        id: 'act-1',
        identifier: 'new.nurse@esic.gov.in',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.activateAccount({ token: 'expired', newPassword: 'NewSecure123!' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an already-used token -- single-use enforced', async () => {
      mockPlatformPrismaService.activationToken.findUnique.mockResolvedValue({
        id: 'act-1',
        identifier: 'new.nurse@esic.gov.in',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(service.activateAccount({ token: 'used', newPassword: 'NewSecure123!' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('sets the password, clears mustChangePassword, bumps tokenVersion, and marks the token used on success', async () => {
      mockPlatformPrismaService.activationToken.findUnique.mockResolvedValue({
        id: 'act-1',
        identifier: 'new.nurse@esic.gov.in',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      mockLoginDirectoryService.resolve.mockResolvedValueOnce({ hospitalId: 'hospital-123' });
      mockPrismaService.user.findUniqueOrThrow.mockResolvedValue(mockUser);

      const result = await service.activateAccount({ token: 'valid-token', newPassword: 'NewSecure123!' });

      expect(result.status).toBe('success');
      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mustChangePassword: false,
            tempPasswordExpiresAt: null,
            tokenVersion: { increment: 1 },
          }),
        }),
      );
      expect(mockPlatformPrismaService.activationToken.update).toHaveBeenCalledWith({
        where: { id: 'act-1' },
        data: { usedAt: expect.any(Date) },
      });
    });
  });
});
