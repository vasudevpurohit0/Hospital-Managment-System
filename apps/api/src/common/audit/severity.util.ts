import { AuditSeverity, AuditStatus } from '@prisma/client';

/** Sensitive entities where locking/deactivating/deleting a record is worth flagging loudly. */
const SENSITIVE_ENTITIES = ['user', 'staff', 'doctor', 'role', 'administrator', 'hospital'];

/**
 * Best-effort classification for the Activity Log's severity badge -- not a
 * formal security taxonomy, just enough signal to make CRITICAL/HIGH entries
 * stand out in the timeline and roll up into the "Critical" stat card.
 */
export function classifySeverity(params: { entityType: string; action: string; status: AuditStatus }): AuditSeverity {
  const entity = params.entityType.toLowerCase();
  const action = params.action.toLowerCase();
  const isSensitiveEntity = SENSITIVE_ENTITIES.some((e) => entity.includes(e));

  if (params.status === 'FAILURE') {
    return action.includes('login') ? 'MEDIUM' : 'HIGH';
  }

  if (action.includes('delete')) {
    return isSensitiveEntity ? 'CRITICAL' : 'HIGH';
  }

  if (isSensitiveEntity && (action.includes('lock') || action.includes('deactivat') || action.includes('permission'))) {
    return 'HIGH';
  }

  if (action.includes('password') || action.includes('activat') || action.includes('login')) {
    return 'MEDIUM';
  }

  return 'LOW';
}
