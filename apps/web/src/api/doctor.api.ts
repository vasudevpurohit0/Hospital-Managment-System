import { apiFetch } from './client';

export const WEEK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export interface WeeklyScheduleEntry {
  day: WeekDay;
  startTime: string;
  endTime: string;
  available: boolean;
}

/**
 * Live shift/attendance state -- distinct from the static `available` field
 * below (an admin-set "does this doctor generally take appointments" flag).
 * AVAILABLE is the only state `callNext` will pull a new patient forward in.
 */
export type DoctorDutyStatus = 'OFF_DUTY' | 'AVAILABLE' | 'ON_BREAK';

export interface DoctorDutyStatusRecord {
  dutyStatus: DoctorDutyStatus;
  dutyStatusChangedAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
}

export interface DoctorProfile {
  id: string;
  name: string;
  email: string;
  active: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
  dateJoined: string;
  department: string;
  consultationRoom: string | null;
  contactPhone: string | null;
  specialty: string;
  experience: string;
  available: boolean;
  verified: boolean;
  departmentId: string | null;
  assignedDepartment: { id: string; name: string; code: string } | null;
  consultationFee: number;
  weeklySchedule: WeeklyScheduleEntry[] | null;
  dutyStatus: DoctorDutyStatus;
  dutyStatusChangedAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  /** Only present on the admin roster (fetchAllDoctorsForAdmin), not the plain active-only list. */
  locked?: boolean;
  failedLoginAttempts?: number;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || fallback);
  }
  return res.json();
}

export async function fetchDoctors(): Promise<DoctorProfile[]> {
  const res = await apiFetch('/api/doctors');
  return unwrap(res, 'Failed to fetch doctors');
}

/** Backs the OPD registration doctor picker -- active, has a profile, belongs to this department. */
export async function fetchEligibleDoctors(departmentId: string): Promise<DoctorProfile[]> {
  const res = await apiFetch(`/api/doctors/eligible?departmentId=${encodeURIComponent(departmentId)}`);
  return unwrap(res, 'Failed to fetch eligible doctors');
}

/** Admin roster: includes deactivated doctors too, unlike the plain active-only fetchDoctors(). */
export async function fetchAllDoctorsForAdmin(): Promise<DoctorProfile[]> {
  const res = await apiFetch('/api/doctors/admin');
  return unwrap(res, 'Failed to fetch doctors');
}

export interface CreateDoctorPayload {
  name: string;
  specialty: string;
  experience: string;
  email: string;
  departmentId?: string;
  consultationFee?: number;
  weeklySchedule?: WeeklyScheduleEntry[];
}

export interface DoctorCreatedResult extends DoctorProfile {
  staffId: string;
  temporaryPassword: string;
}

export async function createDoctor(data: CreateDoctorPayload): Promise<DoctorCreatedResult> {
  const res = await apiFetch('/api/doctors', { method: 'POST', body: JSON.stringify(data) });
  return unwrap(res, 'Failed to create doctor');
}

export interface UpdateDoctorPayload {
  name?: string;
  email?: string;
  verified?: boolean;
  specialty?: string;
  experience?: string;
  departmentId?: string | null;
  consultationFee?: number;
  weeklySchedule?: WeeklyScheduleEntry[];
}

export async function updateDoctor(id: string, data: UpdateDoctorPayload): Promise<DoctorProfile> {
  const res = await apiFetch(`/api/doctors/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  return unwrap(res, 'Failed to update doctor');
}

export async function setDoctorActive(id: string, active: boolean): Promise<DoctorProfile> {
  const res = await apiFetch(`/api/doctors/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) });
  return unwrap(res, 'Failed to update doctor');
}

export interface PasswordResetResult {
  id: string;
  email: string;
  temporaryPassword: string;
}

export async function resetDoctorPassword(id: string, reason?: string): Promise<PasswordResetResult> {
  const res = await apiFetch(`/api/doctors/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ reason }) });
  return unwrap(res, 'Failed to reset password');
}

export async function setDoctorLocked(id: string, locked: boolean, reason?: string): Promise<DoctorProfile> {
  const res = await apiFetch(`/api/doctors/${id}/lock`, { method: 'PATCH', body: JSON.stringify({ locked, reason }) });
  return unwrap(res, 'Failed to update account lock');
}

export async function resendDoctorActivation(id: string): Promise<{ status: string; message: string }> {
  const res = await apiFetch(`/api/doctors/${id}/resend-activation`, { method: 'POST' });
  return unwrap(res, 'Failed to resend activation email');
}

/** Backs the "Auto-assign to least-busy doctor" registration option. Returns the single best doctor (or none), not the full list. */
export async function fetchLeastBusyEligibleDoctor(departmentId: string): Promise<DoctorProfile | null> {
  const res = await apiFetch(`/api/doctors/eligible?departmentId=${encodeURIComponent(departmentId)}&autoAssign=true`);
  const doctors = await unwrap<DoctorProfile[]>(res, 'Failed to auto-assign a doctor');
  return doctors[0] ?? null;
}

/** Self-service duty status -- always the caller's own profile (server derives the id from the JWT). */
export async function fetchMyDutyStatus(): Promise<DoctorDutyStatusRecord> {
  const res = await apiFetch('/api/doctors/me/duty-status');
  return unwrap(res, 'Failed to load your duty status');
}

export async function checkInDoctor(): Promise<DoctorDutyStatusRecord> {
  const res = await apiFetch('/api/doctors/me/check-in', { method: 'POST' });
  return unwrap(res, 'Failed to check in');
}

export async function checkOutDoctor(): Promise<DoctorDutyStatusRecord> {
  const res = await apiFetch('/api/doctors/me/check-out', { method: 'POST' });
  return unwrap(res, 'Failed to check out');
}

export async function startDoctorBreak(): Promise<DoctorDutyStatusRecord> {
  const res = await apiFetch('/api/doctors/me/break/start', { method: 'POST' });
  return unwrap(res, 'Failed to start your break');
}

export async function endDoctorBreak(): Promise<DoctorDutyStatusRecord> {
  const res = await apiFetch('/api/doctors/me/break/end', { method: 'POST' });
  return unwrap(res, 'Failed to end your break');
}
