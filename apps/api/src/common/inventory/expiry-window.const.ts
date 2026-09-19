/**
 * The medicine-batch expiry alert thresholds -- previously reimplemented
 * independently (as the literal `30 * 24 * 60 * 60 * 1000` / `90 * ...`
 * computation) in `analytics.service.ts`, `dashboard.service.ts`,
 * `inventory.service.ts`, and `expiry-scanner.service.ts`, with nothing
 * enforcing the four stayed in sync. A batch expiring within
 * `CRITICAL_ALERT_WINDOW_DAYS` is CRITICAL_ALERT; within
 * `EARLY_WARNING_WINDOW_DAYS` (but beyond the critical window) is
 * EARLY_WARNING -- the same two-tier scheme `ExpiryScannerService` applies
 * to `StockStatus`.
 */
export const CRITICAL_ALERT_WINDOW_DAYS = 30;
export const EARLY_WARNING_WINDOW_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A Date `days` days after `from` (defaults to now). */
export function daysFromNow(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * MS_PER_DAY);
}
