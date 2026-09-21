import { apiFetch } from './client';
import { WeeklyScheduleEntry } from './doctor.api';

/** Every seeded role except Doctor -- Doctor accounts are managed on the Doctor Schedule screen. */
export const STAFF_ROLES = [
  'Reception',
  'AdmissionDesk',
  'Nurse',
  'Pharmacist',
  'StoreManager',
  'ProcurementOfficer',
  'DataEntryOperator',
  'Administrator',
  'QueueManager',
  'LabTechnician',
  'Pathologist',
  'Accountant',
  'OPDDisplayOperator',
  'THERAPY_STAFF',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export interface StaffProfile {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  staffId: string | null;
  department: string;
  designation: string | null;
  contactPhone: string | null;
  active: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
  dateJoined: string;
  weeklySchedule: WeeklyScheduleEntry[];
  departments: { id: string; name: string; code: string; isPrimary: boolean }[];
  /** Only present on the admin roster (fetchAllStaffForAdmin). */
  locked?: boolean;
  failedLoginAttempts?: number;
}

export interface StaffPage {
  items: StaffProfile[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || fallback);
  }
  return res.json();
}

export interface StaffFilters {
  role?: StaffRole;
  department?: string;
  search?: string;
  status?: 'active' | 'inactive' | 'locked';
  page?: number;
  limit?: number;
}

export async function fetchAllStaffForAdmin(filters: StaffFilters = {}): Promise<StaffPage> {
  const params = new URLSearchParams();
  if (filters.role) params.set('role', filters.role);
  if (filters.department) params.set('department', filters.department);
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const res = await apiFetch(`/api/staff?${params.toString()}`);
  return unwrap(res, 'Failed to fetch staff');
}

export interface CreateStaffPayload {
  name: string;
  role: StaffRole;
  email: string;
  department: string;
  designation?: string;
  contactPhone?: string;
  departmentIds?: string[];
  weeklySchedule?: WeeklyScheduleEntry[];
}

export interface StaffCreatedResult extends StaffProfile {
  temporaryPassword: string;
}

export async function createStaff(data: CreateStaffPayload): Promise<StaffCreatedResult> {
  const res = await apiFetch('/api/staff', { method: 'POST', body: JSON.stringify(data) });
  return unwrap(res, 'Failed to create staff member');
}

export interface UpdateStaffPayload {
  name?: string;
  email?: string;
  department?: string;
  designation?: string;
  contactPhone?: string;
  departmentIds?: string[];
  weeklySchedule?: WeeklyScheduleEntry[];
}

export async function updateStaff(id: string, data: UpdateStaffPayload): Promise<StaffProfile> {
  const res = await apiFetch(`/api/staff/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  return unwrap(res, 'Failed to update staff member');
}

export async function setStaffActive(id: string, active: boolean): Promise<StaffProfile> {
  const res = await apiFetch(`/api/staff/${id}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  });
  return unwrap(res, 'Failed to update staff member');
}

export interface StaffPasswordResetResult {
  id: string;
  email: string;
  temporaryPassword: string;
}

export async function resetStaffPassword(
  id: string,
  reason?: string,
): Promise<StaffPasswordResetResult> {
  const res = await apiFetch(`/api/staff/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  return unwrap(res, 'Failed to reset password');
}

export async function setStaffLocked(
  id: string,
  locked: boolean,
  reason?: string,
): Promise<StaffProfile> {
  const res = await apiFetch(`/api/staff/${id}/lock`, {
    method: 'PATCH',
    body: JSON.stringify({ locked, reason }),
  });
  return unwrap(res, 'Failed to update account lock');
}

export async function resendStaffActivation(
  id: string,
): Promise<{ status: string; message: string }> {
  const res = await apiFetch(`/api/staff/${id}/resend-activation`, { method: 'POST' });
  return unwrap(res, 'Failed to resend activation email');
}

/** One row of the "Create Roles Automatically" preview: the role, the login id it would get, and whether it already exists. */
export interface DefaultRoleStatus {
  role: string;
  displayName: string;
  identifier: string;
  exists: boolean;
  active: boolean | null;
}

export async function fetchDefaultRolesStatus(): Promise<DefaultRoleStatus[]> {
  const res = await apiFetch('/api/staff/default-roles');
  return unwrap(res, 'Failed to fetch default roles');
}

export interface CreateDefaultRolesPayload {
  initialPassword: string;
  confirmPassword: string;
  roles?: string[];
  requirePasswordChange?: boolean;
}

export interface DefaultRolesResult {
  created: { role: string; identifier: string }[];
  skipped: { role: string; identifier: string; reason: string }[];
  failed: { role: string; identifier: string; reason: string }[];
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  requirePasswordChange: boolean;
}

export async function createDefaultRoles(
  data: CreateDefaultRolesPayload,
): Promise<DefaultRolesResult> {
  const res = await apiFetch('/api/staff/default-roles', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return unwrap(res, 'Failed to create default role accounts');
}

export interface StaffImpersonationSession {
  accessToken: string;
  expiresIn: string;
  target: { id: string; identifier: string; role: string; name: string };
}

/** Starts a secure impersonation session -- every eligibility rule (self, active/locked/pending status, nested impersonation) is enforced server-side; this call simply surfaces whichever one failed. */
export async function impersonateStaff(id: string): Promise<StaffImpersonationSession> {
  const res = await apiFetch(`/api/staff/${id}/impersonate`, { method: 'POST' });
  return unwrap(res, 'Failed to start impersonation');
}
