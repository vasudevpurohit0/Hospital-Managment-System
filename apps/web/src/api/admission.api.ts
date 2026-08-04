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

import { apiFetch } from './client';

export async function fetchAdmissions(token?: string): Promise<AdmissionRecord[]> {
  const res = await apiFetch('/api/admissions', {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch admissions');
  }
  return res.json();
}

export async function fetchAdmissionById(id: string, token?: string): Promise<AdmissionRecord> {
  const res = await apiFetch(`/api/admissions/${id}`, {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch admission details');
  }
  return res.json();
}

export async function resolveAdmissionEligibility(
  id: string,
  token?: string,
): Promise<AdmissionRecord> {
  const res = await apiFetch(`/api/admissions/${id}/resolve`, { method: 'POST' }, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to resolve admission eligibility');
  }
  return res.json();
}

export interface WardManagementRecord {
  id: string;
  name: string;
  category: string;
  rooms: Array<{
    id: string;
    roomNumber: string;
    type: string;
    beds: Array<{
      id: string;
      bedNumber: string;
      status: string;
      currentAdmission?: {
        id: string;
        visit?: {
          employee?: {
            name: string;
            employeeId: string;
          };
        };
      } | null;
    }>;
  }>;
}

export async function fetchEligibleBeds(id: string, token?: string): Promise<BedRecord[]> {
  const res = await apiFetch(`/api/admissions/${id}/eligible-beds`, {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch eligible available beds');
  }
  return res.json();
}

export async function fetchAllWards(token?: string): Promise<WardManagementRecord[]> {
  const res = await apiFetch('/api/admissions/wards/all', {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch ward management catalog');
  }
  return res.json();
}

export async function createWardAndBed(
  body: {
    wardId?: string;
    wardName?: string;
    wardCategory?: string;
    roomNumber: string;
    bedNumber?: string;
    count?: number;
  },
  token?: string,
): Promise<unknown> {
  const res = await apiFetch(
    '/api/admissions/beds',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to create new ward/bed');
  }
  return res.json();
}

export async function deleteWard(wardId: string, token?: string): Promise<unknown> {
  const res = await apiFetch(`/api/admissions/wards/${wardId}`, { method: 'DELETE' }, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to delete ward');
  }
  return res.json();
}

export async function deleteBed(bedId: string, token?: string): Promise<unknown> {
  const res = await apiFetch(`/api/admissions/beds/${bedId}`, { method: 'DELETE' }, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to delete bed');
  }
  return res.json();
}

export async function allocateBed(
  id: string,
  body: {
    bedId: string;
    assignedDoctorId?: string;
    assignedNurseId?: string;
  },
  token?: string,
): Promise<AdmissionRecord> {
  const res = await apiFetch(
    `/api/admissions/${id}/allocate`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    token,
  );
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || 'Failed to allocate bed');
  }
  return res.json();
}

export async function addAdmissionNote(
  id: string,
  body: { note: string },
  token?: string,
): Promise<AdmissionNoteRecord> {
  const res = await apiFetch(
    `/api/admissions/${id}/notes`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to add admission note');
  }
  return res.json();
}

export async function dischargePatient(
  id: string,
  body: { summaryText: string },
  token?: string,
): Promise<AdmissionRecord> {
  const res = await apiFetch(
    `/api/admissions/${id}/discharge`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to approve discharge');
  }
  return res.json();
}
