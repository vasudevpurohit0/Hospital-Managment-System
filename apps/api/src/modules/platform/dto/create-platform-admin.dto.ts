import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreatePlatformAdminDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
