import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WeeklyScheduleEntryDto } from './weekly-schedule-entry.dto';

export class UpdateDoctorDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  /** Changing this also updates the login identifier (LoginDirectoryService.rename) and is audit-logged separately from a normal profile edit. */
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  verified?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  specialty?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  experience?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  consultationFee?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WeeklyScheduleEntryDto)
  weeklySchedule?: WeeklyScheduleEntryDto[];
}
