import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  IsInt,
  IsPositive,
} from 'class-validator';
import { ApprovalDecision } from '@prisma/client';
import { Type } from 'class-transformer';

export class UpdateRequisitionItemDto {
  @IsString()
  @IsNotEmpty()
  itemId!: string;

  @IsInt()
  @IsPositive()
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
