import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DispenseItemPayloadDto {
  @IsString()
  @IsNotEmpty()
  prescriptionItemId!: string;

  /** Required for an INVENTORY item; must be omitted for a CUSTOM item (there is no batch to select). */
  @IsString()
  @IsOptional()
  medicineBatchId?: string;

  @IsNumber()
  @IsNotEmpty()
  dispenseQuantity!: number;

  /** Pharmacist-entered unit price for a CUSTOM item -- there is no catalogue/batch price to fall back on. Ignored for an INVENTORY item, which is always priced from its dispensed batch. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  unitRate?: number;
}

export class DispenseMedicineDto {
  @IsString()
  @IsNotEmpty()
  prescriptionId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DispenseItemPayloadDto)
  items!: DispenseItemPayloadDto[];
}
