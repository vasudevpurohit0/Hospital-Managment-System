import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetAllHospitalUserPasswordsDto {
  @IsString()
  @MinLength(8)
  newPassword!: string;

  @IsString()
  @IsNotEmpty()
  confirmPassword!: string;
}
