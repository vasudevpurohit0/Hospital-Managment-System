import { apiFetch } from './http';

export interface AdmissionNoteRecord {
  id: string;
  admissionId: string;
  authoredBy: string;
  note: string;
  createdAt: string;
  author: {
    id: string;
    identifier: string;
  };
}

export interface DischargeSummaryRecord {
  id: string;
  admissionId: string;
  approvedBy: string;
  summaryText: string;
  generatedAt: string;
  approver: {
    id: string;
    identifier: string;
  };
}

export interface BedRecord {
  id: string;
  bedNumber: string;
  status: 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE';
  room: {
    id: string;
    roomNumber: string;
    type: 'SINGLE' | 'SHARED' | 'GENERAL';
    ward: {
      id: string;
      name: string;
      category: string;
    };
  };
}

export interface AdmissionRecord {
  id: string;
  visitId: string;
  status:
    | 'REQUESTED'
    | 'ELIGIBILITY_CHECKED'
    | 'AWAITING_BED'
    | 'ALLOCATED'
    | 'UNDER_TREATMENT'
    | 'DISCHARGE_APPROVED'
    | 'DISCHARGED';
  eligibleCategory: string;
  requestedAt: string;
  allocatedAt: string | null;
  dischargedAt: string | null;
  wardId: string | null;
  roomId: string | null;
  bedId: string | null;
  assignedDoctorId: string | null;
  assignedNurseId: string | null;
  visit: {
    id: string;
    employee: {
      id: string;
      employeeId: string;
      name: string;
      department: string;
      post: { title: string };
      grade: { payLevel: string };
    };
  };
  bed?: {
    id: string;
    bedNumber: string;
    status: string;
  } | null;
  assignedDoctor?: {
    id: string;
    identifier: string;
  } | null;
  assignedNurse?: {
    id: string;
    identifier: string;
  } | null;
  notes?: AdmissionNoteRecord[];
  dischargeSummary?: DischargeSummaryRecord | null;
}

export async function fetchAdmissions(token: string): Promise<AdmissionRecord[]> {
  return apiFetch<AdmissionRecord[]>(
    '/api/admissions',
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch admissions',
  );
}

export async function fetchAdmissionById(id: string, token: string): Promise<AdmissionRecord> {
  return apiFetch<AdmissionRecord>(
    `/api/admissions/${id}`,
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch admission details',
  );
}

export async function resolveAdmissionEligibility(
  id: string,
  token: string,
): Promise<AdmissionRecord> {
  return apiFetch<AdmissionRecord>(
    `/api/admissions/${id}/resolve`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
    'Failed to resolve admission eligibility',
  );
}

export async function fetchEligibleBeds(id: string, token: string): Promise<BedRecord[]> {
  return apiFetch<BedRecord[]>(
    `/api/admissions/${id}/eligible-beds`,
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch eligible available beds',
  );
}

export async function allocateBed(
  id: string,
  body: {
    bedId: string;
    assignedDoctorId: string;
    assignedNurseId: string;
  },
  token: string,
): Promise<AdmissionRecord> {
  return apiFetch<AdmissionRecord>(
    `/api/admissions/${id}/allocate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
    'Failed to allocate bed',
  );
}

export async function addAdmissionNote(
  id: string,
  body: { note: string },
  token: string,
): Promise<AdmissionNoteRecord> {
  return apiFetch<AdmissionNoteRecord>(
    `/api/admissions/${id}/notes`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
    'Failed to add admission note',
  );
}

export async function dischargePatient(
  id: string,
  body: { summaryText: string },
  token: string,
): Promise<AdmissionRecord> {
  return apiFetch<AdmissionRecord>(
    `/api/admissions/${id}/discharge`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
    'Failed to approve discharge',
  );
}
