import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

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
  @IsNotEmpty()
  purchasePrice!: number;

  @IsNumber()
  @IsNotEmpty()
  issuePrice!: number;

  @IsNumber()
  @IsNotEmpty()
  currentStock!: number;

  @IsNumber()
  @IsOptional()
  minimumStockLevel?: number;

  @IsNumber()
  @IsOptional()
  reorderLevel?: number;

  @IsNumber()
  @IsOptional()
  maximumStockLevel?: number;

  @IsString()
  @IsOptional()
  storageLocation?: string;
}
