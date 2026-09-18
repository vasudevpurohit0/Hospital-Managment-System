import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetHospitalUserPasswordDto {
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
