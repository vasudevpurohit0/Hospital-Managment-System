export interface Department {
  id: string;
  name: string;
  code: string;
}

export interface OPDVisitRecord {
  id: string;
  visitId: string;
  departmentId: string;
  tokenNumber: string;
  calledAt: string | null;
  closedAt: string | null;
  createdAt: string;
  department?: Department;
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
  payload: { visitId: string; departmentId: string },
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
): Promise<OPDVisitRecord[]> {
  const res = await apiFetch(
    `/api/opd-visits/queue?departmentId=${encodeURIComponent(departmentId)}`,
    {},
    token,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch OPD queue');
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
