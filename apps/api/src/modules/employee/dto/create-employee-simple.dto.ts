import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Plain-text variant of CreateEmployeeDto for the Data Entry Operator's
 * Employee Directory screen — that operator has no UI to look up Post/Grade
 * UUIDs, so this accepts the human-readable names instead and resolves (or
 * creates) the matching Post/Grade/EmploymentType rows, the same find-or-
 * create pattern EmployeeVerificationService already uses for Labour Dept
 * registrations.
 */
export class CreateEmployeeSimpleDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  department!: string;

  @IsString()
  @IsNotEmpty()
  postTitle!: string;

  @IsString()
  @IsNotEmpty()
  gradePayLevel!: string;

  @IsIn(['PERMANENT', 'CONTRACTUAL'])
  employmentTypeCode!: 'PERMANENT' | 'CONTRACTUAL';

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;
}
