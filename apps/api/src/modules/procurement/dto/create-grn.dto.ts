import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GRNItemDto {
  @IsUUID()
  @IsNotEmpty()
  medicineId!: string;

  @IsString()
  @IsNotEmpty()
  batchNumber!: string;

  @IsString()
  @IsNotEmpty()
  manufacturer!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  manufacturingDate!: string;

  @IsString()
  @IsNotEmpty()
  expiryDate!: string;

  @IsNumber()
  @IsPositive()
  purchasePrice!: number;

  @IsNumber()
  @IsPositive()
  issuePrice!: number;

  @IsBoolean()
  @IsOptional()
  qualityCheckPass?: boolean;
}

export class CreateGRNDto {
  @IsUUID()
  @IsNotEmpty()
  purchaseOrderId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GRNItemDto)
  items!: GRNItemDto[];
}
