export interface VerifiedEmployeeData {
  employeeId: string;
  name: string;
  department: string;
  postTitle: string;
  gradePayLevel: string;
  employmentTypeCode: 'PERMANENT' | 'CONTRACTUAL';
  contactPhone?: string;
  contactEmail?: string;
}

export interface VerificationResponse {
  status: 'VERIFIED' | 'UNVERIFIED';
  verifiedData: VerifiedEmployeeData | null;
  message?: string;
  existingPatient?: {
    id: string;
    employeeId: string;
    name: string;
    hospitalUid: string | null;
    registeredAt: string;
  } | null;
}

export interface RegistrationResponse {
  status: 'REGISTERED' | 'ALREADY_REGISTERED' | 'MANUAL_VERIFICATION_PENDING';
  employee?: {
    id: string;
    employeeId: string;
    name: string;
    department: string;
    post: { title: string };
    grade: { payLevel: string };
    employmentType: { code: string; name: string };
    contactPhone?: string;
    contactEmail?: string;
    patientProfile?: { photoUrl?: string | null };
  };
  patientProfile?: {
    photoUrl?: string | null;
  };
  hospitalUid?: {
    uidCode: string;
    issuedAt: string;
  };
  qrDataUrl?: string;
  caseId?: string;
  reason?: string;
}

export interface UidCardDataResponse {
  uidCode: string;
  qrDataUrl: string;
  issuedAt: string;
  employee: {
    id: string;
    employeeId: string;
    name: string;
    department: string;
    post: { title: string };
    grade: { payLevel: string };
    employmentType: { code: string; name: string };
    contactPhone?: string;
    contactEmail?: string;
  };
}

import { apiFetch } from './client';

export async function verifyEmployeeId(
  employeeId: string,
  token?: string,
): Promise<VerificationResponse> {
  const res = await apiFetch(
    '/api/employees/verify',
    {
      method: 'POST',
      body: JSON.stringify({ employeeId }),
    },
    token,
  );

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'Verification request failed');
  }

  return res.json();
}

export async function registerEmployee(
  employeeId: string,
  token?: string,
): Promise<RegistrationResponse> {
  const res = await apiFetch(
    '/api/employees/register',
    {
      method: 'POST',
      body: JSON.stringify({ employeeId }),
    },
    token,
  );

  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Employee ID is already registered');
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'Registration failed');
  }

  return res.json();
}

export async function fetchUidCard(uidCode: string, token?: string): Promise<UidCardDataResponse> {
  const res = await apiFetch(`/api/employees/${encodeURIComponent(uidCode)}/card`, {}, token);

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to fetch Hospital UID Card data');
  }

  return res.json();
}

/* ── Employee Directory (Data Entry Operator's own screen) ── */

export interface EmployeeDirectoryRecord {
  id: string;
  employeeId: string;
  name: string;
  department: string;
  contactPhone: string | null;
  contactEmail: string | null;
  registrationDate: string;
  post: { title: string } | null;
  grade: { payLevel: string } | null;
  employmentType: { code: string; name: string } | null;
  hospitalUid: { uidCode: string } | null;
}

export interface CreateEmployeeSimplePayload {
  employeeId: string;
  name: string;
  department: string;
  postTitle: string;
  gradePayLevel: string;
  employmentTypeCode: 'PERMANENT' | 'CONTRACTUAL';
  contactPhone?: string;
  contactEmail?: string;
}

export async function fetchAllEmployees(token?: string): Promise<EmployeeDirectoryRecord[]> {
  const res = await apiFetch('/api/employees', {}, token);

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to fetch employees');
  }

  return res.json();
}

export async function fetchPostGradeOptions(
  token?: string,
): Promise<{ posts: string[]; grades: string[] }> {
  const res = await apiFetch('/api/employees/post-grade-options', {}, token);

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to fetch post/grade options');
  }

  return res.json();
}

export async function createEmployeeSimple(
  payload: CreateEmployeeSimplePayload,
  token?: string,
): Promise<EmployeeDirectoryRecord> {
  const res = await apiFetch(
    '/api/employees/simple',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  );

  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Employee ID already exists');
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to create employee');
  }

  return res.json();
}

export async function updateEmployeeContact(
  id: string,
  payload: { name?: string; department?: string; contactPhone?: string; contactEmail?: string },
  token?: string,
): Promise<EmployeeDirectoryRecord> {
  const res = await apiFetch(
    `/api/employees/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    token,
  );

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to update employee');
  }

  return res.json();
}

// ── Bulk Employee Import (CSV) ─────────────────────────────────────────────

export type EmployeeImportRowStatus = 'VALID' | 'INVALID' | 'DUPLICATE_FILE' | 'DUPLICATE_EXISTING';

export interface ParsedEmployeeRow {
  rowNum: number;
  employeeId: string;
  name: string;
  department: string;
  postTitle: string;
  gradePayLevel: string;
  employmentTypeRaw: string;
  contactPhone: string;
  contactEmail: string;
}

export interface EmployeeImportPreviewRow {
  rowNum: number;
  employeeId: string;
  status: EmployeeImportRowStatus;
  error: string | null;
  original: ParsedEmployeeRow;
}

export interface EmployeeImportValidation {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  rows: EmployeeImportPreviewRow[];
}

export interface EmployeeImportResult {
  totalRows: number;
  validRows: number;
  importedSuccessfully: number;
  failedRows: number;
  failures: { rowNum: number; employeeId: string; error: string }[];
}

function empFileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

function empDownloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadEmployeeTemplate(token?: string): Promise<void> {
  const res = await apiFetch('/api/employees/import/template', {}, token);
  if (!res.ok) throw new Error('Failed to download template');
  empDownloadBlob(await res.blob(), 'employee_import_template.csv');
}

export async function validateEmployeeImport(file: File, token?: string): Promise<EmployeeImportValidation> {
  const fileBase64 = await empFileToBase64(file);
  const res = await apiFetch(
    '/api/employees/import/validate',
    { method: 'POST', body: JSON.stringify({ fileBase64 }) },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'CSV validation failed');
  }
  return res.json();
}

export async function confirmEmployeeImport(rows: ParsedEmployeeRow[], token?: string): Promise<EmployeeImportResult> {
  const res = await apiFetch(
    '/api/employees/import/confirm',
    { method: 'POST', body: JSON.stringify({ rows }) },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Import failed');
  }
  return res.json();
}

export async function downloadEmployeeErrorReport(
  rows: { rowNum: number; employeeId: string; error: string; original: ParsedEmployeeRow }[],
  token?: string,
): Promise<void> {
  const res = await apiFetch(
    '/api/employees/import/error-report',
    { method: 'POST', body: JSON.stringify({ rows }) },
    token,
  );
  if (!res.ok) throw new Error('Failed to download error report');
  empDownloadBlob(await res.blob(), 'employee_import_errors.csv');
}
