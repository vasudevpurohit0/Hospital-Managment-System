import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreatePrescriptionItemDto } from './create-prescription-item.dto';

export class CreatePrescriptionDto {
  @IsUUID()
  @IsNotEmpty()
  visitId!: string;

  @IsString()
  @IsOptional()
  symptoms?: string;

  @IsString()
  @IsOptional()
  examinationNotes?: string;

  @IsString()
  @IsNotEmpty()
  diagnosisText!: string;

  @IsBoolean()
  @IsOptional()
  followUpFlag?: boolean;

  @IsBoolean()
  @IsOptional()
  admissionRecommended?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePrescriptionItemDto)
  items: CreatePrescriptionItemDto[] = [];

  /**
   * Lab Test Master ids (P3). Previously free-text names, one LabOrder per
   * name — replaced so investigations resolve to real catalogue tests
   * (Feature 6) instead of unmatched strings, and group under one Lab Order
   * the way a doctor actually orders them.
   */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  labTestIds?: string[];
}
