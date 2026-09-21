import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DispenseItemPayloadDto {
  @IsUUID()
  @IsNotEmpty()
  prescriptionItemId!: string;

  /** Required for an INVENTORY item; must be omitted for a CUSTOM item (there is no batch to select). */
  @IsUUID()
  @IsOptional()
  medicineBatchId?: string;

  /**
   * Must be strictly positive: `PharmacyService.dispense()` uses this value
   * directly in a Prisma `decrement` and in a `{ gte: dispenseQuantity }`
   * insufficient-stock guard. A zero or negative value would make the guard
   * vacuously pass (any stock level is `>=` a negative number) and turn the
   * "decrement" into a net stock *increase* — silently inflating inventory
   * instead of dispensing it.
   */
  @IsNumber()
  @IsPositive()
  dispenseQuantity!: number;

  /** Pharmacist-entered unit price for a CUSTOM item -- there is no catalogue/batch price to fall back on. Ignored for an INVENTORY item, which is always priced from its dispensed batch. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  unitRate?: number;
}

export class DispenseMedicineDto {
  @IsUUID()
  @IsNotEmpty()
  prescriptionId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DispenseItemPayloadDto)
  items!: DispenseItemPayloadDto[];
}
