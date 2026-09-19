import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { WeeklyScheduleEntryDto } from './weekly-schedule-entry.dto';
import { STAFF_ROLE_NAMES, StaffRoleName } from './staff-role.const';

export class CreateStaffDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(STAFF_ROLE_NAMES, {
    message: `role must be one of: ${STAFF_ROLE_NAMES.join(', ')} (Doctor accounts are managed from the Doctor Schedule screen)`,
  })
  role!: StaffRoleName;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  department!: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  /** Structured multi-department assignment (mirrors DoctorDepartment) -- first entry becomes the primary. The free-text `department` field above stays as the display value. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  departmentIds?: string[];

  /** Reuses the exact day/startTime/endTime/available shape DoctorSchedulePage already uses -- `available` maps onto StaffShift.active. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WeeklyScheduleEntryDto)
  weeklySchedule?: WeeklyScheduleEntryDto[];
}
