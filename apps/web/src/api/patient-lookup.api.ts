import { apiFetch } from './http';

export interface PatientLookupResponse {
  employee: {
    id: string;
    employeeId: string;
    uid: string;
    name: string;
    department: string;
    post: string;
    grade: string;
    employmentType: string;
    eligibilityCategory: string;
  };
  lastVisit: { id: string; date: string; type: string; status: string } | null;
  openVisit: { id: string; date: string; type: string; status: string } | null;
  activeAdmission: Record<string, unknown> | null;
  openPrescriptions: Record<string, unknown>[];
  historySummary: {
    visitId: string;
    date: string;
    type: string;
    status: string;
    diagnosis?: string;
  }[];
}

export interface CreateVisitPayload {
  employeeId: string;
  type: 'OPD' | 'IPD';
  ignoreOpenVisitWarning?: boolean;
}

export interface CreateVisitResponse {
  status: 'CREATED' | 'OPEN_VISIT_WARNING';
  visit?: {
    id: string;
    employeeId: string;
    type: 'OPD' | 'IPD';
    status: 'OPEN' | 'CLOSED';
    createdAt: string;
  };
  openVisit?: {
    id: string;
    type: string;
    status: string;
    createdAt: string;
  };
  message?: string;
}

export async function lookupPatientByUid(
  uid: string,
  token: string,
): Promise<PatientLookupResponse> {
  return apiFetch<PatientLookupResponse>(
    `/api/patients/lookup?uid=${encodeURIComponent(uid)}`,
    { headers: { Authorization: `Bearer ${token}` } },
    'Patient lookup failed',
  );
}

export interface VisitDetail {
  id: string;
  employeeId: string;
  type: 'OPD' | 'IPD';
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  closedAt: string | null;
  employee: {
    id: string;
    employeeId: string;
    name: string;
    department: string;
    post: { title: string };
    grade: { payLevel: string };
    employmentType: { code: string; name: string };
    patientProfile: { eligibilityCategory: string } | null;
    hospitalUid: { uidCode: string } | null;
  };
  opdVisit: { tokenNumber: string; department: { name: string; code: string } } | null;
  diagnoses: {
    id: string;
    symptoms: string | null;
    examinationNotes: string | null;
    diagnosisText: string;
    followUpFlag: boolean;
    admissionRecommended: boolean;
    createdAt: string;
  }[];
  prescriptions: {
    id: string;
    status: string;
    items: { id: string; medicineName: string; dose: string; frequency: string; duration: string }[];
  }[];
}

export async function fetchVisitById(visitId: string, token: string): Promise<VisitDetail> {
  return apiFetch<VisitDetail>(
    `/api/visits/${encodeURIComponent(visitId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
    'Visit lookup failed',
  );
}

export async function createVisit(
  payload: CreateVisitPayload,
  token: string,
): Promise<CreateVisitResponse> {
  return apiFetch<CreateVisitResponse>(
    '/api/visits',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    'Failed to create visit',
  );
}
