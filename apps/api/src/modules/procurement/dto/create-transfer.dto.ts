import { IsEnum, IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';
import { PharmacyLocation } from '@prisma/client';

export class CreateTransferDto {
  @IsString()
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
