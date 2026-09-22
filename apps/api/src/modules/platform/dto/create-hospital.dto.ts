import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateHospitalDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  // Lowercase, hyphen-separated -- used (with hyphens underscored) as the
  // Postgres schema name; login now resolves purely from a unique identifier,
  // so this no longer doubles as anything the user types in.
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters/numbers separated by single hyphens (e.g. "apollo-chennai")',
  })
  slug!: string;

  @IsString()
  @IsNotEmpty()
  adminIdentifier!: string;

  /**
   * Used as the first Administrator's password AND (see
   * HospitalsService.createHospital) as the shared onboarding password for
   * every other auto-created role account for this hospital -- one initial
   * credential per hospital, not one per account, but still hashed
   * independently per User row and forced to change on first login.
   */
  @IsString()
  @MinLength(8)
  initialPassword!: string;

  @IsString()
  @IsNotEmpty()
  confirmPassword!: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;
}
