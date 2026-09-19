import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * A real class (not `Partial<CreateEmployeeDto>`, which TypeScript erases to
 * `Object` at runtime and silently bypasses the global ValidationPipe's
 * whitelist/forbidNonWhitelisted protection) -- every field optional since
 * this is a partial update, but each one still individually validated and
 * unknown fields still rejected.
 */
export class UpdateEmployeeDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsUUID()
  @IsOptional()
  postId?: string;

  @IsUUID()
  @IsOptional()
  gradeId?: string;

  @IsUUID()
  @IsOptional()
  employmentTypeId?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;
}

/** Fields gated behind the narrower `Employee:reclassify` permission -- see EmployeeController.update. */
export const EMPLOYEE_RECLASSIFICATION_FIELDS = ['postId', 'gradeId', 'employmentTypeId'] as const;
