import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'code must be uppercase letters, numbers and underscores only (e.g. "CARDIO")',
  })
  code?: string;
}
