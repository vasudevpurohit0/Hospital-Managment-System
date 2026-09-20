/**
 * CSV helpers for the Employee Directory "Bulk Import" feature. Mirrors the
 * flow of the existing medicine importer (template / validate / confirm /
 * error-report) but in CSV, using the human-readable Employee Directory
 * columns so a Data Entry Operator can fill it in a spreadsheet.
 *
 * No new dependency: a small RFC-4180-style parser handles quotes, embedded
 * commas/newlines, escaped "" quotes and a UTF-8 BOM. Values written back out
 * (template + error report) are guarded against CSV formula injection.
 */

/** Exact column order of the template. */
export const EMPLOYEE_CSV_HEADERS = [
  'Employee ID',
  'Full Name',
  'Department',
  'Post / Designation',
  'Grade / Pay Level',
  'Employment Type',
  'Contact Phone',
  'Contact Email',
] as const;

/** Safety limits (client validation is never trusted). */
export const EMPLOYEE_IMPORT_MAX_ROWS = 1000;
export const EMPLOYEE_IMPORT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export interface ParsedEmployeeRow {
  rowNum: number; // 1-based data row number as a user sees it (header excluded)
  employeeId: string;
  name: string;
  department: string;
  postTitle: string;
  gradePayLevel: string;
  employmentTypeRaw: string;
  contactPhone: string;
  contactEmail: string;
}

/**
 * Neutralises spreadsheet formula injection: a cell a spreadsheet would
 * evaluate (leading = + - @, tab or CR) is prefixed with a single quote so it
 * opens as literal text. Applied only to values we EMIT (template, error
 * report); stored data stays untouched.
 */
function csvSafeCell(value: string): string {
  const v = value ?? '';
  const needsGuard = /^[=+\-@\t\r]/.test(v);
  const guarded = needsGuard ? `'${v}` : v;
  // Quote if it contains a comma, quote, or newline; escape embedded quotes.
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

function toCsvLine(cells: string[]): string {
  return cells.map(csvSafeCell).join(',');
}

/** Downloadable template: header + two clearly-marked example rows. */
export function generateEmployeeTemplateCsv(): string {
  const rows = [
    [...EMPLOYEE_CSV_HEADERS],
    [
      'EMP-2001',
      'EXAMPLE - Ramesh Kumar (delete this row)',
      'Public Works Department',
      'Junior Engineer',
      'Pay Level 7',
      'PERMANENT',
      '9876500001',
      'ramesh.kumar@example.gov.in',
    ],
    [
      'EMP-2002',
      'EXAMPLE - Sunita Sharma (delete this row)',
      'Health & Family Welfare',
      'Staff Nurse',
      'Pay Level 6',
      'CONTRACTUAL',
      '9876500002',
      'sunita.sharma@example.gov.in',
    ],
  ];
  // BOM so Excel opens UTF-8 correctly; CRLF line endings for Windows tools.
  return '﻿' + rows.map(toCsvLine).join('\r\n') + '\r\n';
}

/** Serialise failed rows (+ reason) back to CSV for the downloadable error report. */
export function generateEmployeeErrorReportCsv(
  rows: { rowNum: number; employeeId: string; error: string; original: Partial<ParsedEmployeeRow> }[],
): string {
  const header = ['Row', ...EMPLOYEE_CSV_HEADERS, 'Error'];
  const lines = [toCsvLine(header)];
  for (const r of rows) {
    const o = r.original;
    lines.push(
      toCsvLine([
        String(r.rowNum),
        o.employeeId ?? r.employeeId ?? '',
        o.name ?? '',
        o.department ?? '',
        o.postTitle ?? '',
        o.gradePayLevel ?? '',
        o.employmentTypeRaw ?? '',
        o.contactPhone ?? '',
        o.contactEmail ?? '',
        r.error,
      ]),
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/**
 * RFC-4180-style tokeniser -> array of records (each an array of field
 * strings). Throws on structurally malformed input (an unterminated quoted
 * field).
 */
function parseCsvRecords(text: string): string[][] {
  const src = text.replace(/^﻿/, ''); // strip BOM
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  let sawAny = false;

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawAny = true;
      i++;
      continue;
    }
    if (ch === ',') {
      record.push(field);
      field = '';
      sawAny = true;
      i++;
      continue;
    }
    if (ch === '\r') {
      // handle CRLF and lone CR
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      sawAny = false;
      i += src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      sawAny = false;
      i++;
      continue;
    }
    field += ch;
    sawAny = true;
    i++;
  }

  if (inQuotes) {
    throw new Error('Malformed CSV: an unterminated quoted value was found.');
  }
  // flush trailing field/record if the file didn't end with a newline
  if (field.length > 0 || record.length > 0 || sawAny) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/** True if a record is entirely empty (all cells blank) -- a blank line. */
function isBlankRecord(cells: string[]): boolean {
  return cells.every((c) => c.trim() === '');
}

export interface ParseResult {
  rows: ParsedEmployeeRow[];
}

/**
 * Parses and structurally validates the uploaded CSV: correct headers, at
 * least one data row, within the row limit. Blank lines are skipped. Throws a
 * message suitable for surfacing to the user on any structural problem.
 */
export function parseEmployeeCsv(text: string): ParseResult {
  const records = parseCsvRecords(text);
  if (records.length === 0) {
    throw new Error('The uploaded CSV is empty.');
  }

  const header = records[0].map((h) => h.trim());
  const expected = EMPLOYEE_CSV_HEADERS.map((h) => h.trim());
  const headerOk =
    header.length >= expected.length &&
    expected.every((h, idx) => (header[idx] ?? '').toLowerCase() === h.toLowerCase());
  if (!headerOk) {
    throw new Error(
      `CSV headers do not match the template. Expected: ${expected.join(', ')}. ` +
        `Download the template and use its exact column order.`,
    );
  }

  const dataRecords = records.slice(1).filter((r) => !isBlankRecord(r));
  if (dataRecords.length === 0) {
    throw new Error('The CSV has headers but no employee data rows.');
  }
  if (dataRecords.length > EMPLOYEE_IMPORT_MAX_ROWS) {
    throw new Error(
      `Too many rows: ${dataRecords.length}. The maximum per import is ${EMPLOYEE_IMPORT_MAX_ROWS}.`,
    );
  }

  const rows: ParsedEmployeeRow[] = dataRecords.map((cells, idx) => ({
    rowNum: idx + 1,
    employeeId: (cells[0] ?? '').trim(),
    name: (cells[1] ?? '').trim(),
    department: (cells[2] ?? '').trim(),
    postTitle: (cells[3] ?? '').trim(),
    gradePayLevel: (cells[4] ?? '').trim(),
    employmentTypeRaw: (cells[5] ?? '').trim(),
    contactPhone: (cells[6] ?? '').trim(),
    contactEmail: (cells[7] ?? '').trim(),
  }));

  return { rows };
}

// --- Field-level validators (shared by validate + confirm) ---

export const EMPLOYEE_ID_REGEX = /^EMP-\d{3,}$/i;
// Indian mobile numbers: 10 digits (optionally +91/0 prefixed). Kept lenient
// but non-empty-format-checked, matching how the app treats contact numbers.
const PHONE_REGEX = /^(?:\+91[-\s]?|0)?[6-9]\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmploymentType(raw: string): 'PERMANENT' | 'CONTRACTUAL' | null {
  const v = raw.trim().toUpperCase();
  if (v === 'PERMANENT' || v === 'CONTRACTUAL') return v;
  return null;
}

/** Returns an error string for the first problem found, or null if the row is field-valid. */
export function validateRowFields(row: ParsedEmployeeRow): string | null {
  if (!row.employeeId) return 'Employee ID is required';
  if (!EMPLOYEE_ID_REGEX.test(row.employeeId)) return 'Invalid Employee ID format (expected EMP-<number>, e.g. EMP-2001)';
  if (!row.name) return 'Full Name is required';
  if (!row.department) return 'Department is required';
  if (!row.postTitle) return 'Post / Designation is required';
  if (!row.gradePayLevel) return 'Grade / Pay Level is required';
  if (!row.employmentTypeRaw) return 'Employment Type is required';
  if (!normaliseEmploymentType(row.employmentTypeRaw))
    return 'Employment Type must be PERMANENT or CONTRACTUAL';
  if (row.contactPhone && !PHONE_REGEX.test(row.contactPhone))
    return 'Invalid Contact Phone (expected a 10-digit Indian mobile number)';
  if (row.contactEmail && !EMAIL_REGEX.test(row.contactEmail)) return 'Invalid Contact Email format';
  return null;
}
