import { apiFetch } from './client';

export type AuditStatus = 'SUCCESS' | 'FAILURE';
export type AuditSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AuditLogEntry {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  changedFields: string[];
  reason: string | null;
  description: string | null;
  status: AuditStatus;
  severity: AuditSeverity;
  ipAddress: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  actorUser: { identifier: string; employee: { name: string; employeeId: string } | null } | null;
  /** Only present on the cross-hospital platform endpoint. */
  hospitalId?: string;
  hospitalName?: string;
}

export interface AuditLogFilters {
  actorUserId?: string;
  action?: string;
  entityType?: string;
  status?: AuditStatus;
  severity?: AuditSeverity;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  meta: { total: number; page?: number; limit?: number; totalPages?: number; note?: string };
}

export interface AuditLogStats {
  total: number;
  last24h: number;
  critical: number;
  failedLogins: number;
}

function buildParams(filters: AuditLogFilters & { hospitalId?: string }): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  return params.toString();
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || fallback);
  }
  return res.json();
}

/** Hospital Administrator's own-hospital Activity Log. */
export async function fetchAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogPage> {
  const res = await apiFetch(`/api/audit-log?${buildParams(filters)}`);
  return unwrap(res, 'Failed to fetch activity log');
}

/** Total / last-24h / critical / failed-login counts backing the stat cards. */
export async function fetchAuditLogStats(): Promise<AuditLogStats> {
  const res = await apiFetch('/api/audit-log/stats');
  return unwrap(res, 'Failed to fetch activity log stats');
}

/** Fetches the CSV through the normal authenticated apiFetch (a plain <a href> can't carry the Bearer token) and returns it as a Blob ready to save. */
export async function exportAuditLogCsv(filters: AuditLogFilters = {}): Promise<Blob> {
  const res = await apiFetch(`/api/audit-log/export.csv?${buildParams(filters)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to export activity log');
  }
  return res.blob();
}

/** Super Admin's cross-hospital Activity Log; omit hospitalId to search every active hospital (capped). */
export async function fetchPlatformStaffAuditLog(
  filters: AuditLogFilters & { hospitalId?: string } = {},
): Promise<AuditLogPage> {
  const res = await apiFetch(`/api/platform/staff-audit-log?${buildParams(filters)}`);
  return unwrap(res, 'Failed to fetch cross-hospital activity log');
}
