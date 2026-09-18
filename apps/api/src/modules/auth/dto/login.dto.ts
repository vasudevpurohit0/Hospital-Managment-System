import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  identifier!: string; // Email or Staff ID -- globally unique across the whole platform, see LoginDirectoryService

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
