import { IsEnum, IsNotEmpty, IsOptional, IsUUID, IsBoolean } from 'class-validator';
import { VisitType } from '@prisma/client';

export class CreateVisitDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId!: string;

  @IsEnum(VisitType)
  @IsNotEmpty()
  type!: VisitType;

  @IsOptional()
  @IsBoolean()
  ignoreOpenVisitWarning?: boolean;
}
