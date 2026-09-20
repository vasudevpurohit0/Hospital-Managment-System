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
  const res = await apiFetch(`/api/staff/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) });
  return unwrap(res, 'Failed to update staff member');
}

export interface StaffPasswordResetResult {
  id: string;
  email: string;
  temporaryPassword: string;
}

export async function resetStaffPassword(id: string, reason?: string): Promise<StaffPasswordResetResult> {
  const res = await apiFetch(`/api/staff/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ reason }) });
  return unwrap(res, 'Failed to reset password');
}

export async function setStaffLocked(id: string, locked: boolean, reason?: string): Promise<StaffProfile> {
  const res = await apiFetch(`/api/staff/${id}/lock`, { method: 'PATCH', body: JSON.stringify({ locked, reason }) });
  return unwrap(res, 'Failed to update account lock');
}

export async function resendStaffActivation(id: string): Promise<{ status: string; message: string }> {
  const res = await apiFetch(`/api/staff/${id}/resend-activation`, { method: 'POST' });
  return unwrap(res, 'Failed to resend activation email');
}
