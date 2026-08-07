import { IsEnum, IsNotEmpty, IsOptional, IsString, IsArray, ValidateNested, IsNumber } from 'class-validator';
import { ApprovalDecision } from '@prisma/client';
import { Type } from 'class-transformer';

export class UpdateRequisitionItemDto {
  @IsString()
  @IsNotEmpty()
  itemId!: string;

  @IsNumber()
  @IsNotEmpty()
  quantity!: number;
}

export class ApproveRequisitionDto {
  @IsEnum(ApprovalDecision)
  @IsNotEmpty()
  decision!: ApprovalDecision;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => UpdateRequisitionItemDto)
  items?: UpdateRequisitionItemDto[];
}
