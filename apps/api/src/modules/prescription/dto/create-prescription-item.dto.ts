import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PrescriptionItemMedicineType } from '@prisma/client';

/** Rejects a whitespace-only value the same way an empty one is rejected -- @IsNotEmpty alone accepts "   ". */
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreatePrescriptionItemDto {
  /**
   * INVENTORY (default, existing behaviour): medicineName was chosen from
   * the hospital's Medicine catalogue. CUSTOM: a free-text medicine not
   * carried in inventory -- pharmacy must never look up or deduct stock
   * for it.
   */
  @IsEnum(PrescriptionItemMedicineType)
  @IsOptional()
  medicineType?: PrescriptionItemMedicineType;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  medicineName!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  dose!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  frequency!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  duration!: string;
}
