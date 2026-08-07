import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RequisitionItemDto {
  @IsString()
  @IsNotEmpty()
  medicineId!: string;

  @IsNumber()
  @IsNotEmpty()
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
