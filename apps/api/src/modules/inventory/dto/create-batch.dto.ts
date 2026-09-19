import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export class CreateBatchDto {
  @IsString()
  @IsNotEmpty()
  medicineId!: string;

  @IsString()
  @IsNotEmpty()
  batchNumber!: string;

  @IsString()
  @IsNotEmpty()
  manufacturer!: string;

  @IsString()
  @IsOptional()
  supplierId?: string;

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

  @IsInt()
  @Min(0)
  currentStock!: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  minimumStockLevel?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  reorderLevel?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  maximumStockLevel?: number;

  @IsString()
  @IsOptional()
  storageLocation?: string;
}
