import { apiFetch } from './client';

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
  existingPatient?: {
    id: string;
    employeeId: string;
    name: string;
    hospitalUid: string | null;
    registeredAt: string;
  } | null;
  message?: string;
}

export interface RegisterPatientPayload {
  employeeId: string;
  dob?: string;
  gender?: string;
  address?: string;
  allergies?: string;
  chronicDiseases?: string;
  bloodGroup?: string;
  eligibilityCategory?: string;
  notes?: string;
  contactPhone?: string;
  contactEmail?: string;
  photoUrl?: string;
}

export interface PatientProfileResponse {
  id: string;
  employeeId: string;
  hospitalUid: string | null;
  qrDataUrl: string | null;
  name: string;
  department: string;
  post: string;
  grade: string;
  employmentType: string;
  employmentTypeName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  registrationDate: string;
  personal: {
    dob: string | null;
    gender: string | null;
    address: string | null;
  };
  medical: {
    eligibilityCategory: string;
    allergies: string | null;
    chronicDiseases: string | null;
    bloodGroup: string | null;
    notes: string | null;
  };
  stats: {
    totalVisits: number;
    openVisit: { id: string; date: string; type: string } | null;
    lastVisit: { id: string; date: string; type: string } | null;
    activeAdmission: { id: string; status: string } | null;
  };
}

export async function verifyEmployee(
  employeeId: string,
  token?: string,
): Promise<VerificationResponse> {
  const res = await apiFetch(
    '/api/patients/verify-employee',
    {
      method: 'POST',
      body: JSON.stringify({ employeeId }),
    },
    token,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Verification request failed');
  }

  return res.json();
}

export async function registerPatient(
  payload: RegisterPatientPayload,
  token?: string,
) {
  const res = await apiFetch(
    '/api/patients/register',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  );

  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Patient is already registered');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Patient registration failed');
  }

  return res.json();
}

export async function getPatientByUid(
  uid: string,
  token?: string,
): Promise<PatientProfileResponse> {
  const res = await apiFetch(`/api/patients/uid/${encodeURIComponent(uid)}`, {}, token);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Patient lookup failed');
  }

  return res.json();
}

export async function getPatientByEmployeeId(
  employeeId: string,
  token?: string,
): Promise<PatientProfileResponse> {
  const res = await apiFetch(`/api/patients/employee/${encodeURIComponent(employeeId)}`, {}, token);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Patient lookup failed');
  }

  return res.json();
}

export async function searchPatients(
  params: {
    query?: string;
    department?: string;
    employmentType?: string;
    status?: string;
    page?: number;
    limit?: number;
  },
  token?: string,
) {
  const searchParams = new URLSearchParams();
  if (params.query) searchParams.set('query', params.query);
  if (params.department) searchParams.set('department', params.department);
  if (params.employmentType) searchParams.set('employmentType', params.employmentType);
  if (params.status) searchParams.set('status', params.status);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));

  const res = await apiFetch(`/api/patients/search?${searchParams.toString()}`, {}, token);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Patient search failed');
  }

  return res.json();
}

export async function getPatientMasterRecord(
  id: string,
  token?: string,
): Promise<any> {
  const res = await apiFetch(`/api/patients/${encodeURIComponent(id)}/master`, {}, token);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch patient master record');
  }

  return res.json();
}

export async function createPatientVisit(
  payload: {
    employeeId: string;
    type: 'OPD' | 'IPD' | 'EMERGENCY';
    departmentId?: string;
    doctorId?: string;
    ignoreOpenVisitWarning?: boolean;
  },
  token?: string,
) {
  const res = await apiFetch(
    '/api/patients/visit',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to create patient visit');
  }

  return res.json();
}

export async function getPatientMedicalHistory(
  identifier: string,
  token?: string,
) {
  const res = await apiFetch(`/api/patients/${encodeURIComponent(identifier)}/history`, {}, token);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch medical history');
  }

  return res.json();
}

export async function updatePatientProfile(
  id: string,
  payload: Partial<RegisterPatientPayload>,
  token?: string,
) {
  const res = await apiFetch(
    `/api/patients/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    token,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to update patient profile');
  }

  return res.json();
}
