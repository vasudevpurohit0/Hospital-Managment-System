export interface Department {
  id: string;
  name: string;
  code: string;
}

export type OpdVisitStatus =
  | 'WAITING'
  | 'CALLED'
  | 'IN_CONSULTATION'
  | 'COMPLETED'
  | 'NO_SHOW'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'TRANSFERRED';

export interface OPDVisitRecord {
  id: string;
  visitId: string;
  departmentId: string;
  doctorId: string | null;
  tokenNumber: string;
  status: OpdVisitStatus;
  priority: number;
  queuePosition: number | null;
  assignedRoomLabel: string | null;
  transferReason: string | null;
  skipReason: string | null;
  queueNotes: string | null;
  assignedAt: string | null;
  checkedInAt: string | null;
  calledAt: string | null;
  consultationStartedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  department?: Department;
  doctor?: {
    id: string;
    identifier: string;
    active: boolean;
    employee?: { name: string; department?: string; consultationRoom?: string | null };
  } | null;
  visit?: {
    id: string;
    employeeId: string;
    type: string;
    status: string;
    employee?: {
      name: string;
      employeeId: string;
      department?: string;
    };
  };
}

import { apiFetch } from './client';

export async function fetchDepartments(token?: string): Promise<Department[]> {
  const res = await apiFetch('/api/departments', {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch departments');
  }
  return res.json();
}

export async function createOpdVisit(
  payload: { visitId: string; departmentId: string; doctorId: string },
  token?: string,
): Promise<{ status: string; opdVisit: OPDVisitRecord; tokenNumber: string }> {
  const res = await apiFetch(
    '/api/opd-visits',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to create OPD visit');
  }
  return res.json();
}

export async function fetchOpdQueue(
  departmentId: string,
  token?: string,
  doctorId?: string,
): Promise<OPDVisitRecord[]> {
  const params = new URLSearchParams({ departmentId });
  if (doctorId) params.set('doctorId', doctorId);
  const res = await apiFetch(`/api/opd-visits/queue?${params.toString()}`, {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch OPD queue');
  }
  return res.json();
}

/** The logged-in doctor's own active (waiting/called/in-consultation) queue -- doctorId is always derived server-side from the JWT. */
export async function fetchMyOpdQueue(token?: string): Promise<OPDVisitRecord[]> {
  const res = await apiFetch('/api/opd-visits/my-queue', {}, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch your queue');
  }
  return res.json();
}

/** Atomically claims the first eligible waiting patient in the caller's own queue. */
export async function callNextOpdVisit(token?: string): Promise<OPDVisitRecord> {
  const res = await apiFetch('/api/opd-visits/call-next', { method: 'POST' }, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to call the next patient');
  }
  return res.json();
}

export async function callOpdToken(id: string, token?: string): Promise<OPDVisitRecord> {
  const res = await apiFetch(
    `/api/opd-visits/${id}/call`,
    {
      method: 'POST',
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to call token');
  }
  return res.json();
}

export async function startOpdConsultation(id: string, token?: string): Promise<OPDVisitRecord> {
  const res = await apiFetch(`/api/opd-visits/${id}/start-consultation`, { method: 'PATCH' }, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to start consultation');
  }
  return res.json();
}

export async function completeOpdConsultation(id: string, token?: string): Promise<OPDVisitRecord> {
  const res = await apiFetch(`/api/opd-visits/${id}/complete`, { method: 'PATCH' }, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to complete the consultation');
  }
  return res.json();
}

export async function markOpdNoShow(id: string, reason?: string, token?: string): Promise<OPDVisitRecord> {
  const res = await apiFetch(
    `/api/opd-visits/${id}/no-show`,
    { method: 'PATCH', body: JSON.stringify({ reason }) },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to mark no-show');
  }
  return res.json();
}

export async function skipOpdVisit(id: string, reason?: string, token?: string): Promise<OPDVisitRecord> {
  const res = await apiFetch(
    `/api/opd-visits/${id}/skip`,
    { method: 'PATCH', body: JSON.stringify({ reason }) },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to skip patient');
  }
  return res.json();
}

export async function cancelOpdVisit(id: string, reason?: string, token?: string): Promise<OPDVisitRecord> {
  const res = await apiFetch(
    `/api/opd-visits/${id}/cancel`,
    { method: 'PATCH', body: JSON.stringify({ reason }) },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to cancel visit');
  }
  return res.json();
}

export async function transferOpdVisit(
  id: string,
  doctorId: string,
  reason?: string,
  token?: string,
): Promise<OPDVisitRecord> {
  const res = await apiFetch(
    `/api/opd-visits/${id}/transfer`,
    { method: 'PATCH', body: JSON.stringify({ doctorId, reason }) },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to transfer visit');
  }
  return res.json();
}

export async function closeOpdVisit(id: string, token?: string): Promise<OPDVisitRecord> {
  const res = await apiFetch(
    `/api/opd-visits/${id}/close`,
    {
      method: 'POST',
    },
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to close OPD visit');
  }
  return res.json();
}
