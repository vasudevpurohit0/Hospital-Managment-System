import { apiFetch } from './client';

export interface HospitalRecord {
  id: string;
  name: string;
  slug: string;
  schemaName: string;
  status: 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED';
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHospitalPayload {
  name: string;
  slug: string;
  adminIdentifier: string;
  adminPassword: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
}

export interface UpdateHospitalPayload {
  name?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
}

export interface PlatformAdminRecord {
  id: string;
  email: string;
  name: string;
  active: boolean;
  createdAt: string;
}

export interface HospitalAdminRecord {
  id: string;
  identifier: string;
  active: boolean;
  hospitalId: string;
  hospitalName: string;
  hospitalSlug: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  method: string | null;
  path: string | null;
  createdAt: string;
  platformUserEmail: string;
  hospitalName: string | null;
  hospitalSlug: string | null;
}

export interface HospitalMetrics {
  hospitalId: string;
  hospitalName: string;
  hospitalSlug: string;
  status: string;
  ok: boolean;
  error?: string;
  totalPatients: number;
  todayOpdVisits: number;
  activeAdmissions: number;
  bedOccupancyRate: number;
  lowStockAlerts: number;
  staffCount: number;
  revenueCollected: number;
}

export interface DashboardSummary {
  hospitalCounts: { total: number; active: number; suspended: number; provisioning: number };
  totals: {
    totalPatients: number;
    todayOpdVisits: number;
    activeAdmissions: number;
    lowStockAlerts: number;
    staffCount: number;
    revenueCollected: number;
  };
  perHospital: HospitalMetrics[];
  attentionNeeded: {
    stuckProvisioning: { id: string; name: string; slug: string; createdAt: string }[];
    lowStockHospitals: { id: string; name: string; lowStockAlerts: number }[];
    failedToLoad: { id: string; name: string; error?: string }[];
  };
}

async function unwrap<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = Array.isArray(err.message) ? err.message.join(', ') : err.message;
    throw new Error(message || fallbackMessage);
  }
  return res.json();
}

export async function listHospitals(): Promise<HospitalRecord[]> {
  const res = await apiFetch('/api/platform/hospitals');
  return unwrap(res, 'Failed to load hospitals');
}

export async function createHospital(payload: CreateHospitalPayload): Promise<HospitalRecord> {
  const res = await apiFetch('/api/platform/hospitals', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return unwrap(res, 'Failed to create hospital');
}

export async function getHospital(id: string): Promise<HospitalRecord> {
  const res = await apiFetch(`/api/platform/hospitals/${id}`);
  return unwrap(res, 'Failed to load hospital');
}

export async function updateHospital(id: string, payload: UpdateHospitalPayload): Promise<HospitalRecord> {
  const res = await apiFetch(`/api/platform/hospitals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return unwrap(res, 'Failed to update hospital');
}

export async function setHospitalStatus(id: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<HospitalRecord> {
  const res = await apiFetch(`/api/platform/hospitals/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  return unwrap(res, 'Failed to update hospital status');
}

export async function resetHospitalUserPassword(
  id: string,
  identifier: string,
  newPassword: string,
): Promise<{ reset: boolean; identifier: string }> {
  const res = await apiFetch(`/api/platform/hospitals/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ identifier, newPassword }),
  });
  return unwrap(res, 'Failed to reset password');
}

export async function deleteHospital(id: string): Promise<{ deleted: boolean }> {
  const res = await apiFetch(`/api/platform/hospitals/${id}`, { method: 'DELETE' });
  return unwrap(res, 'Failed to delete hospital');
}

export async function listPlatformAdmins(): Promise<PlatformAdminRecord[]> {
  const res = await apiFetch('/api/platform/admins');
  return unwrap(res, 'Failed to load platform admins');
}

export async function createPlatformAdmin(payload: {
  email: string;
  name: string;
  password: string;
}): Promise<PlatformAdminRecord> {
  const res = await apiFetch('/api/platform/admins', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return unwrap(res, 'Failed to create platform admin');
}

export async function setPlatformAdminActive(id: string, active: boolean): Promise<PlatformAdminRecord> {
  const res = await apiFetch(`/api/platform/admins/${id}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  });
  return unwrap(res, 'Failed to update platform admin');
}

export async function listHospitalAdmins(): Promise<HospitalAdminRecord[]> {
  const res = await apiFetch('/api/platform/hospital-admins');
  return unwrap(res, 'Failed to load hospital admins');
}

export async function createHospitalAdmin(
  hospitalId: string,
  identifier: string,
  password: string,
): Promise<HospitalAdminRecord> {
  const res = await apiFetch(`/api/platform/hospitals/${hospitalId}/admins`, {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
  return unwrap(res, 'Failed to create hospital admin');
}

export async function setHospitalAdminActive(
  hospitalId: string,
  userId: string,
  active: boolean,
): Promise<HospitalAdminRecord> {
  const res = await apiFetch(`/api/platform/hospitals/${hospitalId}/admins/${userId}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  });
  return unwrap(res, 'Failed to update hospital admin');
}

export async function listAuditLog(): Promise<AuditLogEntry[]> {
  const res = await apiFetch('/api/platform/audit-log');
  return unwrap(res, 'Failed to load audit log');
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const res = await apiFetch('/api/platform/dashboard/summary');
  return unwrap(res, 'Failed to load dashboard summary');
}
