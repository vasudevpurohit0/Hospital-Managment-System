import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const SERVICE_TYPES = [
  'CONSULTATION',
  'TEST',
  'THERAPY',
  'PROCEDURE',
  'PACKAGE',
  'BED_DAY',
  'CARE_PER_DAY',
] as const;

export const SERVICE_APPLICABILITIES = ['OPD', 'IPD', 'BOTH'] as const;
export const SERVICE_UNITS = ['SITTING', 'SESSION', 'DAY', 'COURSE', 'TEST', 'VISIT'] as const;

export class CreateServiceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsUUID()
  categoryId!: string;

  @IsEnum(SERVICE_TYPES)
  serviceType!: (typeof SERVICE_TYPES)[number];

  @IsOptional()
  @IsEnum(SERVICE_APPLICABILITIES)
  applicability?: (typeof SERVICE_APPLICABILITIES)[number];

  @IsOptional()
  @IsEnum(SERVICE_UNITS)
  unit?: (typeof SERVICE_UNITS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  courseDurationDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceReference?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateServiceDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsEnum(SERVICE_TYPES) serviceType?: (typeof SERVICE_TYPES)[number];
  @IsOptional()
  @IsEnum(SERVICE_APPLICABILITIES)
  applicability?: (typeof SERVICE_APPLICABILITIES)[number];
  @IsOptional() @IsEnum(SERVICE_UNITS) unit?: (typeof SERVICE_UNITS)[number];
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsInt() @Min(0) durationMinutes?: number;
  @IsOptional() @IsInt() @Min(0) courseDurationDays?: number;
  @IsOptional() @IsString() @MaxLength(200) sourceReference?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ServiceQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsEnum(SERVICE_TYPES) serviceType?: (typeof SERVICE_TYPES)[number];
  @IsOptional()
  @IsEnum(SERVICE_APPLICABILITIES)
  applicability?: (typeof SERVICE_APPLICABILITIES)[number];
  @IsOptional() @IsString() active?: string;
  @IsOptional() @IsString() unpricedOnly?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
}

/** A price change. Reason is mandatory so history explains itself. */
export class SetPriceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  /** Defaults to now. May be future-dated; may not predate the current version. */
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class PackageComponentDto {
  @IsUUID()
  serviceId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class SetPackageComponentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageComponentDto)
  components!: PackageComponentDto[];
}
