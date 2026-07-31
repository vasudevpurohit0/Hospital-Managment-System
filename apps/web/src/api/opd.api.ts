import { apiFetch } from './http';

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

export async function fetchDepartments(token: string): Promise<Department[]> {
  return apiFetch<Department[]>(
    '/api/departments',
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch departments',
  );
}

export async function createOpdVisit(
  payload: { visitId: string; departmentId: string },
  token: string,
): Promise<{ status: string; opdVisit: OPDVisitRecord; tokenNumber: string }> {
  return apiFetch(
    '/api/opd-visits',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    'Failed to create OPD visit',
  );
}

export async function fetchOpdQueue(
  departmentId: string,
  token: string,
): Promise<OPDVisitRecord[]> {
  return apiFetch<OPDVisitRecord[]>(
    `/api/opd-visits/queue?departmentId=${encodeURIComponent(departmentId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
    'Failed to fetch OPD queue',
  );
}

export async function callOpdToken(id: string, token: string): Promise<OPDVisitRecord> {
  return apiFetch<OPDVisitRecord>(
    `/api/opd-visits/${id}/call`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
    'Failed to call OPD token',
  );
}

export async function closeOpdVisit(id: string, token: string): Promise<OPDVisitRecord> {
  return apiFetch<OPDVisitRecord>(
    `/api/opd-visits/${id}/close`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
    'Failed to close OPD visit',
  );
}
