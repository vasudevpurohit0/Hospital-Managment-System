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
