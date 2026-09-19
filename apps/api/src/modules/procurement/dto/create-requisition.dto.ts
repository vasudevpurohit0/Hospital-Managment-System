import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RequisitionItemDto {
  @IsString()
  @IsNotEmpty()
  medicineId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class CreateRequisitionDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequisitionItemDto)
  items!: RequisitionItemDto[];

  @IsBoolean()
  @IsOptional()
  triggeredByAlert?: boolean;

  @IsString()
  @IsOptional()
  triggerReason?: string;
}
