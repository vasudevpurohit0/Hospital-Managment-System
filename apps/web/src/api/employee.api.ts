import { apiFetch } from './http';

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

export async function verifyEmployeeId(
  employeeId: string,
  token: string,
): Promise<VerificationResponse> {
  return apiFetch<VerificationResponse>(
    '/api/employees/verify',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ employeeId }),
    },
    'Verification request failed',
  );
}

export async function registerEmployee(
  employeeId: string,
  token: string,
): Promise<RegistrationResponse> {
  return apiFetch<RegistrationResponse>(
    '/api/employees/register',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ employeeId }),
    },
    (status) => (status === 409 ? 'Employee ID is already registered' : 'Registration failed'),
  );
}

export async function fetchUidCard(uidCode: string, token: string): Promise<UidCardDataResponse> {
  return apiFetch<UidCardDataResponse>(
    `/api/employees/${encodeURIComponent(uidCode)}/card`,
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch Hospital UID Card data',
  );
}
