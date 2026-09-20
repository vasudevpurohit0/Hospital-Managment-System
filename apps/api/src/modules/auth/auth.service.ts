import {
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto, ResetPasswordWithTokenDto } from './dto/forgot-password.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { PlatformJwtPayload } from './strategies/platform-jwt.strategy';
import { PlatformPrismaService } from '../../common/tenant/platform-prisma.service';
import { TenantClientFactory } from '../../common/tenant/tenant-client-factory';
import { LoginDirectoryService } from '../../common/tenant/login-directory.service';
import { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_PLATFORM_SECRET } from '../../common/config/jwt-secrets';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { generateResetToken, hashResetToken } from '../../common/security/password.util';
import { EmailService } from '../../common/email/email.service';
import { ActivateAccountDto } from './dto/activate-account.dto';
import { activationEmailBody, ACTIVATION_EMAIL_SUBJECT } from '../../common/email/templates';
import { parseUserAgent } from '../../common/audit/request-meta.util';

interface RefreshPayload {
  sub: string;
  identifier: string;
  hospitalId: string;
  schemaName: string;
  type: 'refresh';
  /**
   * V-02: mirrors the access token's tokenVersion so a password change,
   * password reset, account activation, or /auth/logout call -- all of
   * which already bump the User row's tokenVersion -- also invalidates any
   * refresh token issued before that point, not just access tokens.
   * Optional so a refresh token issued before this field existed still
   * verifies once (same backward-compatibility rule jwt.strategy.ts uses).
   */
  tokenVersion?: number;
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
    private emailService: EmailService,
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
          employee: {
            select: { name: true, department: true },
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

    // A temporary password (never one the user chose themselves) stops
    // working after 24h if never used to actually change it -- applies
    // uniformly to every temp password, not only ones sent by email.
    if (user.mustChangePassword && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt < new Date()) {
      throw new UnauthorizedException(
        'This temporary password has expired. Ask your administrator to reset your password or resend your activation email.',
      );
    }

    return user;
  }

  async login(loginDto: LoginDto, meta: RequestMeta = {}) {
    // Normalized once, here, so every downstream lookup (directory, tenant
    // User row, activity records, JWT payload) agrees on the same identifier
    // regardless of how the caller capitalized/spaced it.
    loginDto = { ...loginDto, identifier: loginDto.identifier.trim().toLowerCase() };

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
    const { browser, os, device } = parseUserAgent(meta.userAgent);

    let user;
    try {
      user = await this.validateUser(loginDto.identifier, loginDto.password);
    } catch (err: unknown) {
      const reason = err instanceof UnauthorizedException && err.message === 'User account inactive' ? 'INACTIVE' : 'BAD_PASSWORD';
      await this.prisma.loginActivity
        .create({ data: { identifier: loginDto.identifier, success: false, reason, ipAddress: meta.ip, userAgent: meta.userAgent } })
        .catch(() => undefined);
      await this.loginDirectory.recordFailure(loginDto.identifier);
      await this.prisma.auditLog
        .create({
          data: {
            actorRole: 'Unknown',
            action: 'auth.login_failed',
            entityType: 'Auth',
            entityId: loginDto.identifier,
            status: 'FAILURE',
            severity: 'MEDIUM',
            description: `Failed login attempt for "${loginDto.identifier}" (${reason})`,
            ipAddress: meta.ip,
            browser,
            os,
            device,
          },
        })
        .catch(() => undefined);
      throw err;
    }

    await this.prisma.loginActivity
      .create({ data: { userId: user.id, identifier: loginDto.identifier, success: true, ipAddress: meta.ip, userAgent: meta.userAgent } })
      .catch(() => undefined);
    await this.loginDirectory.recordSuccess(loginDto.identifier);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => undefined);

    // `roleId` is a required, foreign-key-backed field on every User row, so
    // `user.role` being missing here means the referenced Role itself is
    // gone -- a data-integrity failure, not a normal case to paper over.
    // Silently treating that account as a Doctor would embed the wrong role
    // in the JWT, the audit log, and the response the client displays.
    if (!user.role) {
      this.logger.error(`User "${user.id}" (${loginDto.identifier}) has no resolvable role (roleId=${user.roleId})`);
      throw new InternalServerErrorException('Your account is not fully configured. Contact your administrator.');
    }
    const roleName = user.role.name;
    await this.prisma.auditLog
      .create({
        data: {
          actorUserId: user.id,
          actorRole: roleName,
          action: 'auth.login_success',
          entityType: 'Auth',
          entityId: user.id,
          status: 'SUCCESS',
          severity: 'LOW',
          description: `Successful login for "${loginDto.identifier}"`,
          ipAddress: meta.ip,
          browser,
          os,
          device,
        },
      })
      .catch(() => undefined);

    const payload: JwtPayload = {
      sub: user.id,
      identifier: user.identifier,
      roleId: user.roleId,
      roleName,
      hospitalId,
      schemaName,
      tokenVersion: user.tokenVersion,
      type: 'access',
    };

    const refreshPayload: RefreshPayload = {
      sub: user.id,
      identifier: user.identifier,
      hospitalId,
      schemaName,
      type: 'refresh',
      tokenVersion: user.tokenVersion,
    };

    try {
      const accessToken = this.jwtService.sign(payload, {
        secret: JWT_ACCESS_SECRET,
        expiresIn: (process.env.JWT_EXPIRES_IN as any) || '8h',
      });

      const refreshToken = this.jwtService.sign(refreshPayload, {
        secret: JWT_REFRESH_SECRET,
        expiresIn: '7d',
      });

      return {
        accessToken,
        refreshToken,
        mode: 'hospital' as const,
        mustChangePassword: user.mustChangePassword,
        user: {
          id: user.id,
          identifier: user.identifier,
          role: roleName,
          // Real person's name/department, when this account is linked to an
          // Employee record (every Doctor/Nurse/Pharmacist/etc. account created
          // through the admin UI is). Omitted rather than defaulted here so the
          // frontend's own role-display-name fallback (e.g. "Doctor",
          // "Pharmacist") still applies for accounts with no Employee link --
          // previously this field was never sent at all, so every staff
          // member's name in the UI silently fell back to their role name
          // instead of showing who is actually logged in.
          name: user.employee?.name,
          department: user.employee?.department,
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
        secret: JWT_PLATFORM_SECRET,
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
        secret: JWT_REFRESH_SECRET,
      });

      if (payload.type !== 'refresh' || !payload.hospitalId || !payload.schemaName) {
        throw new UnauthorizedException('Invalid refresh token type');
      }
    } catch {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    // V-13: hospitalId/schemaName above come straight from the JWT with no
    // re-check against the platform DB -- without this, suspending a
    // hospital does nothing to its staff's already-issued refresh tokens,
    // leaving up to a 7-day window (the refresh token TTL) where a
    // suspended hospital's staff can keep minting fresh access tokens.
    // Mirrors the same check resetPasswordWithToken() already does.
    const hospital = await this.platformPrisma.hospital.findUnique({
      where: { id: payload.hospitalId },
    });
    if (!hospital || hospital.status !== 'ACTIVE') {
      throw new UnauthorizedException('This hospital account is no longer active.');
    }

    const client = await this.tenantClients.getClient(payload.schemaName);
    return runWithTenant(
      { hospitalId: payload.hospitalId, schemaName: payload.schemaName, prismaClient: client },
      () => this.issueAccessTokenFromRefresh(payload),
    );
  }

  /**
   * V-02: bumps tokenVersion so every outstanding access AND refresh token
   * for this user is rejected from this point on -- both jwt.strategy.ts
   * (access tokens) and issueAccessTokenFromRefresh() (refresh tokens) above
   * already compare the token's tokenVersion against the live User row.
   * Platform (Super Admin) tokens have no tokenVersion/refresh-token
   * mechanism at all today, so there's nothing server-side to revoke for
   * them; logout there is a client-side no-op that still returns success.
   */
  async logout(user: AuthenticatedUser): Promise<{ status: 'success' }> {
    if (user.type === 'hospital') {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { tokenVersion: { increment: 1 } },
      });
    }
    return { status: 'success' };
  }

  /** Self-service password change -- the mustChangePassword flow and any voluntary change both go through this. */
  async changePassword(user: AuthenticatedUser, dto: ChangePasswordDto) {
    if (user.type !== 'hospital') {
      throw new BadRequestException('Self-service password change is only available for hospital-staff accounts.');
    }

    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const isMatch = await bcrypt.compare(dto.currentPassword, record.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          tempPasswordExpiresAt: null,
          tokenVersion: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          actorRole: user.roleName,
          action: 'auth.password_changed',
          entityType: 'User',
          entityId: user.id,
        },
      });
    });

    return { status: 'success', message: 'Password changed successfully.' };
  }

  /**
   * Always returns the same generic message regardless of whether the
   * identifier resolves to anything -- never lets a caller enumerate valid
   * accounts. The token itself is returned nowhere: there is no email/SMS
   * service anywhere in this codebase to deliver it, so for now the
   * practical path to a new password stays the existing admin-triggered
   * reset (DoctorService.resetPassword), which shows the new password once
   * exactly like account creation. This endpoint is real, working
   * infrastructure for a future delivery channel, not wired to one yet.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ status: 'success'; message: string }> {
    const generic = {
      status: 'success' as const,
      message: 'If that account exists, a password reset has been initiated. Contact your administrator for assistance.',
    };

    const resolved = await this.loginDirectory.resolve(dto.identifier);
    if (!resolved || !resolved.hospitalId) {
      return generic; // unknown identifier, or a platform account (not supported by this flow) -- same response either way
    }

    const token = generateResetToken();
    const tokenHash = hashResetToken(token);
    await this.platformPrisma.passwordResetToken.create({
      data: {
        identifier: dto.identifier.trim().toLowerCase(),
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    return generic;
  }

  async resetPasswordWithToken(dto: ResetPasswordWithTokenDto) {
    const tokenHash = hashResetToken(dto.token);
    const record = await this.platformPrisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('This reset link is invalid or has expired.');
    }

    const resolved = await this.loginDirectory.resolve(record.identifier);
    if (!resolved || !resolved.hospitalId) {
      throw new UnauthorizedException('This reset link is invalid or has expired.');
    }

    const hospital = await this.platformPrisma.hospital.findUnique({ where: { id: resolved.hospitalId } });
    if (!hospital || hospital.status !== 'ACTIVE') {
      throw new UnauthorizedException('This reset link is invalid or has expired.');
    }

    const client = await this.tenantClients.getClient(hospital.schemaName);
    await runWithTenant({ hospitalId: hospital.id, schemaName: hospital.schemaName, prismaClient: client }, async () => {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { identifier: record.identifier } });
      const passwordHash = await bcrypt.hash(dto.newPassword, 10);
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash,
            mustChangePassword: false,
            passwordChangedAt: new Date(),
            tempPasswordExpiresAt: null,
            tokenVersion: { increment: 1 },
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            actorRole: 'System/ForgotPassword',
            action: 'auth.password_reset_via_token',
            entityType: 'User',
            entityId: user.id,
          },
        });
      });
    });

    await this.platformPrisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });

    return { status: 'success', message: 'Password reset successfully. You can now log in with your new password.' };
  }

  /**
   * Generates a fresh 24h single-use activation token and emails it.
   * Called right after a staff/doctor creation transaction COMMITS, never
   * from inside it -- a failed or slow email send must never roll back a
   * successful account creation. Any previously-outstanding, unused token
   * for this identifier is invalidated first, so only the newest link ever
   * works (also used for "resend activation").
   */
  async sendActivationEmail(params: {
    identifier: string;
    staffName: string;
    staffId: string | null;
    role: string;
    hospitalId: string;
    actorUserId?: string;
  }): Promise<void> {
    const identifier = params.identifier.trim().toLowerCase();

    await this.platformPrisma.activationToken.updateMany({
      where: { identifier, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = generateResetToken();
    const tokenHash = hashResetToken(token);
    await this.platformPrisma.activationToken.create({
      data: { identifier, tokenHash, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) },
    });

    const hospital = await this.platformPrisma.hospital.findUnique({ where: { id: params.hospitalId } });
    const activationLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/activate?token=${token}`;

    const { html, text } = activationEmailBody({
      staffName: params.staffName,
      staffId: params.staffId,
      role: params.role,
      hospitalName: hospital?.name || 'your hospital',
      loginEmail: identifier,
      activationLink,
      supportContact: process.env.SUPPORT_CONTACT_EMAIL || 'your hospital administrator',
    });

    await this.emailService.sendMail({
      to: identifier,
      subject: ACTIVATION_EMAIL_SUBJECT,
      html,
      text,
      kind: 'ACTIVATION',
      sentByUserId: params.actorUserId,
    });
  }

  async activateAccount(dto: ActivateAccountDto) {
    const tokenHash = hashResetToken(dto.token);
    const record = await this.platformPrisma.activationToken.findUnique({ where: { tokenHash } });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('This activation link is invalid or has expired.');
    }

    const resolved = await this.loginDirectory.resolve(record.identifier);
    if (!resolved || !resolved.hospitalId) {
      throw new UnauthorizedException('This activation link is invalid or has expired.');
    }

    const hospital = await this.platformPrisma.hospital.findUnique({ where: { id: resolved.hospitalId } });
    if (!hospital || hospital.status !== 'ACTIVE') {
      throw new UnauthorizedException('This activation link is invalid or has expired.');
    }

    const client = await this.tenantClients.getClient(hospital.schemaName);
    await runWithTenant({ hospitalId: hospital.id, schemaName: hospital.schemaName, prismaClient: client }, async () => {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { identifier: record.identifier } });
      const passwordHash = await bcrypt.hash(dto.newPassword, 10);
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash,
            mustChangePassword: false,
            passwordChangedAt: new Date(),
            tempPasswordExpiresAt: null,
            tokenVersion: { increment: 1 },
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            actorRole: 'System/Activation',
            action: 'auth.account_activated',
            entityType: 'User',
            entityId: user.id,
          },
        });
      });
    });

    await this.platformPrisma.activationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });

    return { status: 'success', message: 'Account activated. You can now log in with your new password.' };
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

      if (payload.tokenVersion !== undefined && payload.tokenVersion !== user.tokenVersion) {
        throw new UnauthorizedException('Refresh token has been revoked');
      }

      // Same data-integrity guard as login() above -- the outer catch turns
      // any thrown error here into a generic "invalid refresh token", so
      // this never leaks the real reason, but it stops a broken role from
      // silently becoming a valid "Doctor" access token.
      if (!user.role) {
        throw new Error(`User "${user.id}" has no resolvable role (roleId=${user.roleId})`);
      }
      const roleName = user.role.name;

      const accessPayload: JwtPayload = {
        sub: user.id,
        identifier: user.identifier,
        roleId: user.roleId,
        roleName,
        hospitalId: payload.hospitalId,
        schemaName: payload.schemaName,
        tokenVersion: user.tokenVersion,
        type: 'access',
      };

      const newAccessToken = this.jwtService.sign(accessPayload, {
        secret: JWT_ACCESS_SECRET,
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
