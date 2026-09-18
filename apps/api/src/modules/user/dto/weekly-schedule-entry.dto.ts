import { IsBoolean, IsIn, Matches } from 'class-validator';

export const WEEK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class WeeklyScheduleEntryDto {
  @IsIn(WEEK_DAYS)
  day!: WeekDay;

  @Matches(TIME_RE, { message: 'startTime must be HH:MM in 24-hour time' })
  startTime!: string;

  @Matches(TIME_RE, { message: 'endTime must be HH:MM in 24-hour time' })
  endTime!: string;

  @IsBoolean()
  available!: boolean;
}
