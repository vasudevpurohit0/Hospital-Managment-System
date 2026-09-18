import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateHospitalDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  // Lowercase, hyphen-separated -- used both as the login-form hospital code
  // and (with hyphens underscored) as the Postgres schema name.
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters/numbers separated by single hyphens (e.g. "apollo-chennai")',
  })
  slug!: string;

  @IsString()
  @IsNotEmpty()
  adminIdentifier!: string;

  @IsString()
  @MinLength(8)
  adminPassword!: string;

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
