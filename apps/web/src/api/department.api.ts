import { apiFetch } from './client';

export interface DepartmentRecord {
  id: string;
  name: string;
  code: string;
  active: boolean;
  createdAt: string;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || fallback);
  }
  return res.json();
}

/** Admin roster: includes deactivated departments too, unlike the plain OPD-registration dropdown (opd.api.ts's fetchDepartments). */
export async function fetchAllDepartmentsForAdmin(token?: string): Promise<DepartmentRecord[]> {
  const res = await apiFetch('/api/departments/admin', {}, token);
  return unwrap(res, 'Failed to load departments');
}

export async function createDepartment(payload: { name: string; code: string }, token?: string): Promise<DepartmentRecord> {
  const res = await apiFetch('/api/departments', { method: 'POST', body: JSON.stringify(payload) }, token);
  return unwrap(res, 'Failed to create department');
}

export async function updateDepartment(
  id: string,
  payload: { name?: string; code?: string },
  token?: string,
): Promise<DepartmentRecord> {
  const res = await apiFetch(`/api/departments/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }, token);
  return unwrap(res, 'Failed to update department');
}

export async function setDepartmentActive(id: string, active: boolean, token?: string): Promise<DepartmentRecord> {
  const res = await apiFetch(`/api/departments/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) }, token);
  return unwrap(res, 'Failed to update department');
}
