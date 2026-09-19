/**
 * Minimal, dependency-free CSV rendering — quotes only where a value needs
 * it, and neutralizes CSV/Excel formula injection (OWASP-standard mitigation:
 * a leading `'` forces Excel/Sheets to treat a cell starting with
 * `=`/`+`/`-`/`@` as literal text instead of a formula). Only applied to
 * string values -- a genuine numeric cell (e.g. a negative amount) is passed
 * through untouched, since `-500` typed as `number` can never be a formula
 * and prefixing it would wrongly turn a real number into text.
 */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const FORMULA_PREFIX_RE = /^[=+\-@]/;
  const escape = (v: string | number): string => {
    let s = String(v ?? '');
    if (typeof v === 'string' && FORMULA_PREFIX_RE.test(s)) {
      s = `'${s}`;
    }
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  return lines.join('\r\n');
}
