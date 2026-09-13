import { apiFetch } from './client';

export type TherapySessionStatus = 'SCHEDULED' | 'PERFORMED' | 'CANCELLED' | 'NO_SHOW';
export type TherapyCourseStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
/** Which of the three valid entry points opened this course/session — always server-derived, never client-supplied. */
export type TherapySource = 'DIRECT' | 'OPD' | 'IPD';

export interface TherapySessionRecord {
  id: string;
  visitId: string;
  admissionId: string | null;
  serviceId: string;
  courseId: string | null;
  sessionNumber: number;
  source: TherapySource;
  scheduledAt: string;
  performedAt: string | null;
  status: TherapySessionStatus;
  notes: string | null;
  service: { code: string; name: string; serviceType: string };
  course?: { id: string; plannedSessions: number; status: TherapyCourseStatus } | null;
  chargeItems: { id: string; netAmount: string; status: string }[];
  visit?: {
    employee: { name: string; employeeId: string; hospitalUid: { uidCode: string } | null };
  };
  createdBy?: { identifier: string } | null;
  performedBy?: { identifier: string } | null;
}

export interface TherapyCourseRecord {
  id: string;
  visitId: string;
  admissionId: string | null;
  serviceId: string;
  plannedSessions: number;
  source: TherapySource;
  status: TherapyCourseStatus;
  startedAt: string;
  completedAt: string | null;
  service: { code: string; name: string };
  sessions: TherapySessionRecord[];
  visit?: {
    employee: { name: string; employeeId: string; hospitalUid: { uidCode: string } | null };
  };
  createdBy?: { identifier: string } | null;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.message;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : msg || fallback);
  }
  return res.json();
}

/** The therapy schedule/session list (Feature 1/7). Pass `date` (YYYY-MM-DD) for the console's "today" view, `source` to narrow by entry point, or `visitId` to scope to one patient. */
export async function fetchTherapySessions(
  token?: string,
  params?: { visitId?: string; date?: string; source?: TherapySource },
): Promise<TherapySessionRecord[]> {
  const qs = new URLSearchParams();
  if (params?.visitId) qs.set('visitId', params.visitId);
  if (params?.date) qs.set('date', params.date);
  if (params?.source) qs.set('source', params.source);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiFetch(`/api/therapy/sessions${suffix}`, {}, token);
  return unwrap(res, 'Failed to load therapy sessions');
}

export async function fetchTherapyCourses(
  token?: string,
  params?: { visitId?: string; source?: TherapySource },
): Promise<TherapyCourseRecord[]> {
  const qs = new URLSearchParams();
  if (params?.visitId) qs.set('visitId', params.visitId);
  if (params?.source) qs.set('source', params.source);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiFetch(`/api/therapy/courses${suffix}`, {}, token);
  return unwrap(res, 'Failed to load therapy courses');
}

/** Opens a course package — bills the full course rate once, immediately. Source (Direct/OPD/IPD) is derived server-side from the visit/admissionId, never sent here. */
export async function openTherapyCourse(
  payload: { visitId: string; admissionId?: string; serviceId: string; plannedSessions: number },
  token?: string,
): Promise<TherapyCourseRecord> {
  const res = await apiFetch('/api/therapy/courses', { method: 'POST', body: JSON.stringify(payload) }, token);
  return unwrap(res, 'Failed to open therapy course');
}

/** Schedules one standalone sitting — bills only when performed. */
export async function scheduleTherapySession(
  payload: { visitId: string; admissionId?: string; serviceId: string; scheduledAt?: string; notes?: string },
  token?: string,
): Promise<TherapySessionRecord> {
  const res = await apiFetch('/api/therapy/sessions', { method: 'POST', body: JSON.stringify(payload) }, token);
  return unwrap(res, 'Failed to schedule therapy session');
}

export async function performTherapySession(
  id: string,
  notes: string | undefined,
  token?: string,
): Promise<TherapySessionRecord> {
  const res = await apiFetch(`/api/therapy/sessions/${id}/perform`, { method: 'POST', body: JSON.stringify({ notes }) }, token);
  return unwrap(res, 'Failed to mark session performed');
}

export async function cancelTherapySession(id: string, token?: string): Promise<TherapySessionRecord> {
  const res = await apiFetch(`/api/therapy/sessions/${id}/cancel`, { method: 'POST' }, token);
  return unwrap(res, 'Failed to cancel therapy session');
}

/** Marks a session a no-show — the slot was held but the patient never came. Billing-identical to cancel (no charge either way), tracked separately for staff visibility. */
export async function markTherapyNoShow(id: string, token?: string): Promise<TherapySessionRecord> {
  const res = await apiFetch(`/api/therapy/sessions/${id}/no-show`, { method: 'POST' }, token);
  return unwrap(res, 'Failed to mark session as no-show');
}
