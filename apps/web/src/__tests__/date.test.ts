import { describe, it, expect } from 'vitest';
import {
  formatDateDefault,
  formatDateIN,
  formatDateDDMonYYYY,
  formatDateMedium,
  formatDateFull,
  formatDateTimeDefault,
  formatDateTimeIN,
  formatDateTimeMedium,
} from '../utils/date';

const SAMPLE = new Date('2026-09-19T10:30:00Z');

describe('utils/date (shared date-formatting helpers, previously duplicated inline across ~16 files)', () => {
  it('accepts both a Date and an ISO string, producing the same result', () => {
    expect(formatDateIN(SAMPLE)).toBe(formatDateIN(SAMPLE.toISOString()));
    expect(formatDateDDMonYYYY(SAMPLE)).toBe(formatDateDDMonYYYY(SAMPLE.toISOString()));
  });

  it('formatDateDDMonYYYY renders day/short-month/year', () => {
    expect(formatDateDDMonYYYY(SAMPLE)).toMatch(/^\d{2} \w{3,4} 2026$/);
  });

  it('formatDateFull includes the weekday and full month name', () => {
    const result = formatDateFull(SAMPLE);
    expect(result).toContain('2026');
    expect(result.split(' ').length).toBeGreaterThanOrEqual(4);
  });

  it('formatDateTimeMedium includes both a date and a time component', () => {
    const result = formatDateTimeMedium(SAMPLE);
    expect(result).toContain('2026');
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('every formatter returns a non-empty string for a valid date', () => {
    for (const fn of [formatDateDefault, formatDateIN, formatDateDDMonYYYY, formatDateMedium, formatDateFull, formatDateTimeDefault, formatDateTimeIN, formatDateTimeMedium]) {
      expect(fn(SAMPLE).length).toBeGreaterThan(0);
    }
  });
});
