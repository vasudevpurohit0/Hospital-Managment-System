import { WeeklyScheduleEntry, WeekDay, WEEK_DAYS } from '../api/doctor.api';
import { formatDateDDMonYYYY } from './date';

export const DAY_LABELS: Record<WeekDay, string> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

export function defaultSchedule(): WeeklyScheduleEntry[] {
  return WEEK_DAYS.map((day) => ({
    day,
    startTime: '09:00',
    endTime: '17:00',
    available: day !== 'SAT' && day !== 'SUN',
  }));
}

export function scheduleSummary(schedule: WeeklyScheduleEntry[] | null): string {
  if (!schedule || schedule.length === 0) return 'No schedule set';
  const active = schedule.filter((e) => e.available);
  if (active.length === 0) return 'Unavailable all week';
  if (active.length === 7) return `Daily, ${active[0].startTime} - ${active[0].endTime}`;
  return `${active.length} day${active.length === 1 ? '' : 's'}/week, ${active[0].startTime} - ${active[0].endTime}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  return formatDateDDMonYYYY(iso);
}
