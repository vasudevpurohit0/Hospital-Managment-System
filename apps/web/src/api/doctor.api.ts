import { apiFetch } from './client';

export const WEEK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export interface WeeklyScheduleEntry {
  day: WeekDay;
  startTime: string;
  endTime: string;
  available: boolean;
}

export interface DoctorProfile {
  id: string;
  name: string;
  email: string;
  active: boolean;
  department: string;
  specialty: string;
  experience: string;
  available: boolean;
  departmentId: string | null;
  assignedDepartment: { id: string; name: string; code: string } | null;
  consultationFee: number;
  weeklySchedule: WeeklyScheduleEntry[] | null;
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

export async function createDoctor(data: CreateDoctorPayload): Promise<DoctorProfile & { temporaryPassword: string }> {
  const res = await apiFetch('/api/doctors', { method: 'POST', body: JSON.stringify(data) });
  return unwrap(res, 'Failed to create doctor');
}

export interface UpdateDoctorPayload {
  name?: string;
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
