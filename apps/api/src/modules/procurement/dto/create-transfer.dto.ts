import { IsEnum, IsInt, IsNotEmpty, IsPositive, IsUUID } from 'class-validator';
import { PharmacyLocation } from '@prisma/client';

export class CreateTransferDto {
  @IsUUID()
  @IsNotEmpty()
  medicineBatchId!: string;

  @IsEnum(PharmacyLocation)
  @IsNotEmpty()
  fromLocation!: PharmacyLocation;

  @IsEnum(PharmacyLocation)
  @IsNotEmpty()
  toLocation!: PharmacyLocation;

  @IsInt()
  @IsPositive()
  quantity!: number;
}
