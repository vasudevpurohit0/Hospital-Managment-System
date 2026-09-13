import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class OpenCourseDto {
  @IsUUID()
  visitId!: string;

  @IsOptional()
  @IsUUID()
  admissionId?: string;

  @IsUUID()
  serviceId!: string;

  @IsInt()
  @Min(1)
  @Max(60)
  plannedSessions!: number;
}

export class ScheduleSessionDto {
  @IsUUID()
  visitId!: string;

  @IsOptional()
  @IsUUID()
  admissionId?: string;

  @IsUUID()
  serviceId!: string;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class PerformSessionDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
