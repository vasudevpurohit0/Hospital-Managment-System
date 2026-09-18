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
