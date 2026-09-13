import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const LAB_PRIORITIES = ['ROUTINE', 'URGENT', 'STAT'] as const;

export class CreateLabOrderDto {
  @IsUUID()
  visitId!: string;

  @IsOptional()
  @IsUUID()
  admissionId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  labTestIds!: string[];

  @IsOptional()
  @IsIn(LAB_PRIORITIES)
  priority?: (typeof LAB_PRIORITIES)[number];

  @IsOptional()
  @IsString()
  clinicalNotes?: string;
}

export class CollectSampleDto {
  @IsOptional()
  @IsString()
  specimenType?: string;
}

export class ResultEntryDto {
  @IsUUID()
  parameterId!: string;

  @IsString()
  value!: string;
}

export class EnterResultsDto {
  @IsUUID()
  labOrderItemId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ResultEntryDto)
  results!: ResultEntryDto[];
}

export class VerifyLabOrderDto {
  @IsOptional()
  @IsString()
  pathologistRemarks?: string;
}

export class CreateLabTestDto {
  @IsUUID()
  serviceId!: string;

  @IsString()
  @MinLength(2)
  code!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsIn(['HAEMATOLOGY', 'BIOCHEMISTRY', 'SEROLOGY', 'CLINICAL_PATHOLOGY', 'MICROBIOLOGY'])
  discipline!: string;

  @IsString()
  specimenType!: string;

  @IsOptional()
  @IsString()
  containerType?: string;
}
