import { IsArray, IsInt, IsNotEmpty, IsNumber, IsPositive, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class POItemDto {
  @IsString()
  @IsNotEmpty()
  medicineId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsNumber()
  @IsPositive()
  unitPrice!: number;
}

export class CreatePODto {
  @IsString()
  @IsNotEmpty()
  requisitionId!: string;

  @IsString()
  @IsNotEmpty()
  supplierId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => POItemDto)
  items!: POItemDto[];
}
