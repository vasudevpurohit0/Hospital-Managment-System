/**
 * Tenant `audit_logs.actor_user_id` is a FK to the *tenant-schema* `users`
 * table. A platform (SuperAdmin) JWT carries a *platform-DB* user id, which
 * never exists in any tenant schema -- writing it verbatim violates
 * `audit_logs_actor_user_id_fkey` and rolls back the whole transaction
 * (e.g. POST /api/doctors as SuperAdmin with `x-hospital-id` failed with a
 * 500 for exactly this reason).
 *
 * Every tenant-schema audit write must therefore resolve the actor through
 * this helper: hospital actors keep their id, platform actors (and missing
 * actors) become NULL while `actorRole` still records who did it
 * (e.g. 'SuperAdmin').
 */
export interface AuditActor {
  id: string;
  roleName: string;
  /** Discriminates a hospital-staff token from a global Super Admin (platform) */
  type?: 'hospital' | 'platform';
}

export function toAuditActorUserId(
  actor?: { id?: string | null; type?: string } | null,
): string | null {
  if (!actor?.id) return null;
  if (actor.type === 'platform') return null;
  return actor.id;
}

export function toTenantActorUserId(
  user?: { id?: string | null; type?: string } | null,
): string | undefined {
  if (!user?.id) return undefined;
  if (user.type === 'platform') return undefined;
  return user.id;
}
