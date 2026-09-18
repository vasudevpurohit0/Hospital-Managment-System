import {
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { PlatformJwtPayload } from './strategies/platform-jwt.strategy';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { LoginDirectoryService } from '../../common/tenant/login-directory.service';
import { runWithTenant } from '../../common/tenant/tenant-context';

interface RefreshPayload {
  sub: string;
  identifier: string;
  hospitalId: string;
  schemaName: string;
  type: 'refresh';
}

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

/**
 * Single unified login surface for the whole platform: one form, one
 * endpoint, {identifier, password} only. LoginDirectoryService resolves
 * which hospital (or the platform) an identifier belongs to before any
 * tenant schema or the platform-user table is even queried -- see that
 * service for why a global directory is required. This class used to be
 * hospital-staff-only, with a separate PlatformAuthService for the Super
 * Admin; that class's logic now lives here as loginAsPlatformUser().
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private platformPrisma: PlatformPrismaService,
    private tenantClients: TenantClientFactory,
    private loginDirectory: LoginDirectoryService,
  ) {}

  async validateUser(identifier: string, pass: string) {
    if (!identifier || typeof identifier !== 'string' || !pass || typeof pass !== 'string') {
      throw new UnauthorizedException('Invalid credentials');
    }

    let user;
    try {
      user = await this.prisma.user.findUnique({
        where: { identifier: identifier.trim() },
        include: {
          role: {
            include: {
              permissions: true,
            },
          },
        },
      });
    } catch (err: unknown) {
      if (err instanceof UnauthorizedException || err instanceof ServiceUnavailableException) {
        throw err;
      }
      this.logger.error(`Database error during validateUser lookup for "${identifier}":`, err);
      throw new ServiceUnavailableException('Database service is currently unavailable.');
    }

    if (!user) {
      throw new UnauthorizedException('Invalid credentials or account inactive');
    }

    if (!user.active) {
      throw new UnauthorizedException('User account inactive');
    }

    if (!user.passwordHash || typeof user.passwordHash !== 'string') {
      throw new UnauthorizedException('Invalid credentials');
    }

    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(pass, user.passwordHash);
    } catch (err: unknown) {
      this.logger.error(`Password comparison error for user "${identifier}":`, err);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  async login(loginDto: LoginDto, meta: RequestMeta = {}) {
    await this.loginDirectory.checkLock(loginDto.identifier);

    const resolved = await this.loginDirectory.resolve(loginDto.identifier);
    if (!resolved) {
      await this.platformPrisma.platformLoginActivity
        .create({
          data: {
            identifier: loginDto.identifier,
            success: false,
            reason: 'UNKNOWN_IDENTIFIER',
            ipAddress: meta.ip,
            userAgent: meta.userAgent,
          },
        })
        .catch(() => undefined);
      throw new UnauthorizedException('Invalid credentials');
    }

    return resolved.hospitalId
      ? this.loginAsHospitalStaff(loginDto, resolved.hospitalId, meta)
      : this.loginAsPlatformUser(loginDto, meta);
  }

  private async loginAsHospitalStaff(loginDto: LoginDto, hospitalId: string, meta: RequestMeta) {
    const hospital = await this.platformPrisma.hospital.findUnique({ where: { id: hospitalId } });
    if (!hospital || hospital.status !== 'ACTIVE') {
      // The directory pointed at a real hospital, but it's gone/suspended --
      // still a generic credentials failure to the caller, and still counts
      // toward that identifier's lockout like any other failure.
      await this.loginDirectory.recordFailure(loginDto.identifier);
      throw new UnauthorizedException('Invalid credentials');
    }

    const client = await this.tenantClients.getClient(hospital.schemaName);
    return runWithTenant(
      { hospitalId: hospital.id, schemaName: hospital.schemaName, prismaClient: client },
      () => this.loginWithinTenant(loginDto, hospital.id, hospital.schemaName, meta),
    );
  }

  private async loginWithinTenant(loginDto: LoginDto, hospitalId: string, schemaName: string, meta: RequestMeta) {
    let user;
    try {
      user = await this.validateUser(loginDto.identifier, loginDto.password);
    } catch (err: unknown) {
      const reason = err instanceof UnauthorizedException && err.message === 'User account inactive' ? 'INACTIVE' : 'BAD_PASSWORD';
      await this.prisma.loginActivity
        .create({ data: { identifier: loginDto.identifier, success: false, reason, ipAddress: meta.ip, userAgent: meta.userAgent } })
        .catch(() => undefined);
      await this.loginDirectory.recordFailure(loginDto.identifier);
      throw err;
    }

    await this.prisma.loginActivity
      .create({ data: { userId: user.id, identifier: loginDto.identifier, success: true, ipAddress: meta.ip, userAgent: meta.userAgent } })
      .catch(() => undefined);
    await this.loginDirectory.recordSuccess(loginDto.identifier);

    const roleName = user.role?.name || 'Doctor';

    const payload: JwtPayload = {
      sub: user.id,
      identifier: user.identifier,
      roleId: user.roleId,
      roleName,
      hospitalId,
      schemaName,
      type: 'access',
    };

    const refreshPayload: RefreshPayload = {
      sub: user.id,
      identifier: user.identifier,
      hospitalId,
      schemaName,
      type: 'refresh',
    };

    try {
      const accessToken = this.jwtService.sign(payload, {
        secret: process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_key_12345',
        expiresIn: (process.env.JWT_EXPIRES_IN as any) || '8h',
      });

      const refreshToken = this.jwtService.sign(refreshPayload, {
        secret: process.env.JWT_REFRESH_SECRET || 'dev_jwt_refresh_secret_key_67890',
        expiresIn: '7d',
      });

      return {
        accessToken,
        refreshToken,
        mode: 'hospital' as const,
        user: {
          id: user.id,
          identifier: user.identifier,
          role: roleName,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`JWT signing error during login for "${user.identifier}":`, err);
      throw new InternalServerErrorException('Failed to generate authentication tokens.');
    }
  }

  private async loginAsPlatformUser(loginDto: LoginDto, meta: RequestMeta) {
    const user = await this.platformPrisma.platformUser.findUnique({ where: { email: loginDto.identifier.trim() } });

    if (!user || !user.active) {
      await this.recordPlatformFailure(loginDto.identifier, 'INACTIVE', meta);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isMatch) {
      await this.recordPlatformFailure(loginDto.identifier, 'BAD_PASSWORD', meta);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.platformPrisma.platformLoginActivity
      .create({ data: { identifier: loginDto.identifier, success: true, ipAddress: meta.ip, userAgent: meta.userAgent } })
      .catch(() => undefined);
    await this.loginDirectory.recordSuccess(loginDto.identifier);

    const payload: PlatformJwtPayload = {
      sub: user.id,
      email: user.email,
      type: 'platform',
    };

    try {
      const accessToken = this.jwtService.sign(payload, {
        secret: process.env.JWT_PLATFORM_SECRET || 'dev_jwt_platform_secret_key_platform',
        expiresIn: (process.env.JWT_PLATFORM_EXPIRES_IN as any) || '8h',
      });

      return {
        accessToken,
        mode: 'platform' as const,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`JWT signing error during platform login for "${user.email}":`, err);
      throw new InternalServerErrorException('Failed to generate authentication tokens.');
    }
  }

  private async recordPlatformFailure(identifier: string, reason: string, meta: RequestMeta) {
    await this.platformPrisma.platformLoginActivity
      .create({ data: { identifier, success: false, reason, ipAddress: meta.ip, userAgent: meta.userAgent } })
      .catch(() => undefined);
    await this.loginDirectory.recordFailure(identifier);
  }

  async refreshTokens(refreshTokenDto: RefreshTokenDto) {
    let payload: RefreshPayload;
    try {
      payload = this.jwtService.verify(refreshTokenDto.refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'dev_jwt_refresh_secret_key_67890',
      });

      if (payload.type !== 'refresh' || !payload.hospitalId || !payload.schemaName) {
        throw new UnauthorizedException('Invalid refresh token type');
      }
    } catch {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    const client = await this.tenantClients.getClient(payload.schemaName);
    return runWithTenant(
      { hospitalId: payload.hospitalId, schemaName: payload.schemaName, prismaClient: client },
      () => this.issueAccessTokenFromRefresh(payload),
    );
  }

  private async issueAccessTokenFromRefresh(payload: RefreshPayload) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { role: true },
      });

      if (!user || !user.active) {
        throw new UnauthorizedException('User no longer active');
      }

      const roleName = user.role?.name || 'Doctor';

      const accessPayload: JwtPayload = {
        sub: user.id,
        identifier: user.identifier,
        roleId: user.roleId,
        roleName,
        hospitalId: payload.hospitalId,
        schemaName: payload.schemaName,
        type: 'access',
      };

      const newAccessToken = this.jwtService.sign(accessPayload, {
        secret: process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_key_12345',
        expiresIn: (process.env.JWT_EXPIRES_IN as any) || '8h',
      });

      return {
        accessToken: newAccessToken,
      };
    } catch {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }
  }
}
