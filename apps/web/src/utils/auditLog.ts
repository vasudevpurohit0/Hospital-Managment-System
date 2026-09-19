import { AuditLogEntry, AuditSeverity, AuditStatus } from '../api/audit-log.api';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Best-effort display verb for an action string -- interceptor-generated actions
 * are "{entity}.{httpMethod}"; hand-written ones (auth.login_failed, staff.locked)
 * are already a readable suffix. */
export function actionVerb(action: string): string {
  const suffix = action.split('.').pop() ?? action;
  switch (suffix) {
    case 'post':
      return 'CREATE';
    case 'put':
    case 'patch':
      return 'UPDATE';
    case 'delete':
      return 'DELETE';
    default:
      return suffix.replace(/_/g, ' ').toUpperCase();
  }
}

export function actionBadgeVariant(action: string): BadgeVariant {
  const verb = actionVerb(action);
  if (verb === 'CREATE') return 'success';
  if (verb === 'UPDATE') return 'info';
  if (verb === 'DELETE') return 'danger';
  return 'neutral';
}

export function severityBadgeVariant(severity: AuditSeverity): BadgeVariant {
  switch (severity) {
    case 'CRITICAL':
      return 'danger';
    case 'HIGH':
      return 'warning';
    case 'MEDIUM':
      return 'info';
    default:
      return 'neutral';
  }
}

export function statusBadgeVariant(status: AuditStatus): BadgeVariant {
  return status === 'SUCCESS' ? 'success' : 'danger';
}

/** All Activity Log timestamps are shown in IST regardless of the viewer's own timezone/locale. */
export function formatIST(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

export function formatISTShortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

export function formatISTDateHeading(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

export function actorDisplayName(entry: AuditLogEntry): string {
  return (
    entry.actorUser?.employee?.name ??
    entry.actorUser?.identifier ??
    (entry.actorUserId ? entry.actorUserId : 'System')
  );
}

export function actorInitial(entry: AuditLogEntry): string {
  const name = actorDisplayName(entry);
  return name.charAt(0).toUpperCase() || '?';
}
