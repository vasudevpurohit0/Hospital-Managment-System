import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'code must be uppercase letters, numbers and underscores only (e.g. "CARDIO")',
  })
  code!: string;
}
