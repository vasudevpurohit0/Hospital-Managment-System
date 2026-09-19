import { Controller, Post, Body, Get, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto, ResetPasswordWithTokenDto } from './dto/forgot-password.dto';
import { ActivateAccountDto } from './dto/activate-account.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() req: Request) {
    return this.authService.login(loginDto, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshTokens(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshTokens(refreshTokenDto);
  }

  @Get('me')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return {
      user,
    };
  }

  /** In the RbacGuard mustChangePassword allowlist -- reachable even before the forced first-login change completes. */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthenticatedUser) {
    return this.authService.changePassword(user, dto);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password-with-token')
  @HttpCode(HttpStatus.OK)
  async resetPasswordWithToken(@Body() dto: ResetPasswordWithTokenDto) {
    return this.authService.resetPasswordWithToken(dto);
  }

  @Public()
  @Post('activate-account')
  @HttpCode(HttpStatus.OK)
  async activateAccount(@Body() dto: ActivateAccountDto) {
    return this.authService.activateAccount(dto);
  }
}
