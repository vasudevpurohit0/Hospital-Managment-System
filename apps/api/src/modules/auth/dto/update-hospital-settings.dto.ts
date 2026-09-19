import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const VALID_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * V-20: `PUT /settings/hospital` previously typed its body as
 * `Partial<typeof DEFAULT_HOSPITAL_SETTINGS>` -- a TypeScript-only type that
 * erases to `Object` at runtime, so the global ValidationPipe's
 * `whitelist`/`forbidNonWhitelisted` had no decorators to enforce and let any
 * field (including unrelated ones) through unvalidated. A real class closes
 * that gap the same way UpdatePatientProfileDto/UpdateBrandingDto already do.
 */
export class UpdateHospitalSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(5)
  workingHoursStart?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  workingHoursEnd?: string;

  @IsOptional()
  @IsArray()
  @IsIn(VALID_DAYS, { each: true })
  workingDays?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxPercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  billingPrefix?: string;

  @IsOptional()
  @IsBoolean()
  notifyOnAdmission?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnDischarge?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnLowStock?: boolean;

  @IsOptional()
  @IsBoolean()
  sendTemporaryPasswordByEmail?: boolean;
}
