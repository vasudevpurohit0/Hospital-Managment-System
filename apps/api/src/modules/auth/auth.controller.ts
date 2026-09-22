import { Controller, Post, Body, Get, HttpCode, HttpStatus, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto, ResetPasswordWithTokenDto } from './dto/forgot-password.dto';
import { ActivateAccountDto } from './dto/activate-account.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { setAccessTokenCookie, setPlatformTokenCookie, clearAuthCookies } from '../../common/auth/auth-cookies.util';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // V-04: an IP-wide backstop on top of LoginDirectoryService's existing
  // per-identifier lockout (5 failed attempts/15min) -- that lockout alone
  // does nothing against a distributed/low-and-slow attempt spread across
  // many different identifiers from the same source.
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(loginDto, { ip: req.ip, userAgent: req.headers['user-agent'] });
    if (result.mode === 'platform') {
      setPlatformTokenCookie(res, result.accessToken);
    } else {
      setAccessTokenCookie(res, result.accessToken);
    }
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshTokens(@Body() refreshTokenDto: RefreshTokenDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.refreshTokens(refreshTokenDto);
    // refreshTokens() is hospital-staff only (see AuthService.refreshTokens's
    // own hospitalId/schemaName check) -- never a platform session.
    setAccessTokenCookie(res, result.accessToken);
    return result;
  }

  @Get('me')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return {
      user,
    };
  }

  /** V-02: revokes every outstanding access/refresh token for this user by bumping tokenVersion, closing the "logout does nothing server-side" gap. */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.logout(user);
    clearAuthCookies(res);
    return result;
  }

  /**
   * Ends the caller's own impersonation session (audit only -- see
   * AuthService.endImpersonation). Reachable by any authenticated user, same
   * as logout/getProfile/changePassword: it acts purely on the caller's own
   * token, never a target the caller specifies, so no @RequirePermission
   * applies (see rbac-matrix.spec.ts's ALLOWED_WITHOUT_GUARD for this file's
   * existing routes that follow the same reasoning). Throws if the caller's
   * token isn't actually an impersonation session.
   */
  @Post('exit-impersonation')
  @HttpCode(HttpStatus.OK)
  async exitImpersonation(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.endImpersonation(user);
  }

  /** In the RbacGuard mustChangePassword allowlist -- reachable even before the forced first-login change completes. */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthenticatedUser) {
    return this.authService.changePassword(user, dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password-with-token')
  @HttpCode(HttpStatus.OK)
  async resetPasswordWithToken(@Body() dto: ResetPasswordWithTokenDto) {
    return this.authService.resetPasswordWithToken(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('activate-account')
  @HttpCode(HttpStatus.OK)
  async activateAccount(@Body() dto: ActivateAccountDto) {
    return this.authService.activateAccount(dto);
  }
}
