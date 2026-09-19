import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GRNItemDto {
  @IsString()
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
  @IsString()
  @IsNotEmpty()
  purchaseOrderId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GRNItemDto)
  items!: GRNItemDto[];
}
