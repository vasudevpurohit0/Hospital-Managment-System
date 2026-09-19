/**
 * Shared date-formatting helpers. Before this, the same handful of
 * `toLocaleDateString`/`toLocaleString` option objects were retyped inline
 * at ~45 call sites across 16 files -- each name below is one of those
 * distinct formats, extracted so a future change to any of them (or a fix
 * to one) happens in one place. Each function preserves the exact
 * locale/options the call sites it replaces already used, so this is a
 * pure de-duplication, not a visual/behavior change.
 *
 * `Activity Log`/`Audit Log` screens intentionally pin `timeZone:
 * 'Asia/Kolkata'` (see `utils/auditLog.ts`'s own `formatIST*` helpers) and
 * are left separate from these, since that's a deliberate, narrower
 * IST-regardless-of-viewer rule, not the same general-purpose formatting.
 */

/** Browser-default short date, e.g. "9/19/2026" (no locale/options). */
export function formatDateDefault(date: Date | string): string {
  return new Date(date).toLocaleDateString();
}

/** Indian-locale short date with no extra options, e.g. "19/9/2026". */
export function formatDateIN(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-IN');
}

/** "19 Sep 2026" -- the most common explicit date format across admission/billing/reception screens. */
export function formatDateDDMonYYYY(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Intl's medium date style in en-IN, e.g. "19 Sept 2026". */
export function formatDateMedium(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

/** Full readable date with weekday, e.g. "Saturday, 19 September 2026". */
export function formatDateFull(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/** Browser-default date+time (no locale/options). */
export function formatDateTimeDefault(date: Date | string): string {
  return new Date(date).toLocaleString();
}

/** Indian-locale date+time with no dateStyle/timeStyle. */
export function formatDateTimeIN(date: Date | string): string {
  return new Date(date).toLocaleString('en-IN');
}

/** Medium date + short time in en-IN, e.g. "19 Sept 2026, 4:30 pm". */
export function formatDateTimeMedium(date: Date | string): string {
  return new Date(date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
