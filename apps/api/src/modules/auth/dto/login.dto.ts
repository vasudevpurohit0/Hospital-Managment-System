import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  identifier!: string; // Email or Staff ID -- globally unique across the whole platform, see LoginDirectoryService

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;
}

/**
 * Optional (2026-09-22 audit): a cookie-based browser session no longer
 * needs to send this in the body at all -- AuthController.refreshTokens()
 * falls back to the httpOnly esic_refresh_token cookie when it's absent.
 * Still required in practice for any caller relying on the body (a
 * non-browser API consumer, existing tests) -- the controller throws its
 * own clean 401 if neither the body nor the cookie has one.
 */
export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}
