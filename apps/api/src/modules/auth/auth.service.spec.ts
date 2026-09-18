import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';

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
    },
  };

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
  };

  const mockTenantClientFactory = {
    getClient: jest.fn().mockResolvedValue(mockPrismaService),
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
  });

  describe('login()', () => {
    it('should issue accessToken and refreshToken on successful login', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.login({
        identifier: 'doctor@esic.gov.in',
        password: 'DoctorPass123!',
        hospitalCode: 'test-hospital',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.role).toBe('Doctor');
    });
  });
});
