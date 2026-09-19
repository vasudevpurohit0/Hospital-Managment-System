import { ArrayMaxSize, IsArray, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { WeeklyScheduleEntryDto } from './weekly-schedule-entry.dto';

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  /** Changing this also updates the login identifier (LoginDirectoryService.rename) and is audit-logged separately from a normal profile edit. */
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  department?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  departmentIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WeeklyScheduleEntryDto)
  weeklySchedule?: WeeklyScheduleEntryDto[];
}
