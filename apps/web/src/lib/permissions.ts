/**
 * Client-side mirror of the server's RBAC matrix (apps/api/prisma/seed.ts →
 * PERMISSION_GRANTS, enforced by RbacGuard).
 *
 * This decides only whether an action control is RENDERED. The server is
 * always the real authority: every gated action is re-checked there, and a
 * role that slipped past this check would still receive a 403.
 *
 * It is centralised because hand-rolling the check per screen had already
 * drifted from the server. The Laboratory workbench gated "Collect Sample" on
 * `userRole === 'LabTechnician' || userRole === 'Pathologist'`, which excludes
 * SuperAdmin — yet SuperAdmin bypasses every permission check in RbacGuard and
 * the sidebar routes it to that very screen. The result was a workflow with no
 * reachable next step: the order sat at ORDERED showing "Awaiting sample
 * collection by Lab Technician" and nothing in the UI could advance it.
 *
 * Rule: a capability listed here must name every role the seed grants it, and
 * SuperAdmin must never be filtered out.
 */

/**
 * Roles the seed grants each capability, by the permission it maps to.
 * SuperAdmin is deliberately absent — it is handled by the bypass in `can`,
 * exactly as RbacGuard does it.
 */
const CAPABILITY_ROLES = {
  /** LabSample:create */
  'lab:collectSample': ['LabTechnician', 'Pathologist'],
  /** LabResult:create */
  'lab:enterResults': ['LabTechnician', 'Pathologist'],
  /** LabResult:verify — a technician's entry is never the final report. */
  'lab:verifyReport': ['Pathologist'],
  /** TherapySession:create — Reception/Administrator book Direct-Therapy at registration; dedicated Therapy staff schedule sessions against doctor orders. */
  'therapy:order': ['Doctor', 'Reception', 'Administrator', 'THERAPY_STAFF'],
  /** TherapySession:update — marking a session performed / cancelling it: nursing, the dedicated Therapy/Panchakarma staff, and the hospital Administrator who oversees the therapy workflow. */
  'therapy:markPerformed': ['Nurse', 'THERAPY_STAFF', 'Administrator'],
} as const;

export type Capability = keyof typeof CAPABILITY_ROLES;

/**
 * Whether `userRole` may perform `capability`.
 *
 * SuperAdmin short-circuits to true, mirroring RbacGuard's single bypass —
 * omitting it client-side is what dead-ended the lab sample-collection step.
 */
export function can(userRole: string | undefined | null, capability: Capability): boolean {
  if (!userRole) return false;
  if (userRole === 'SuperAdmin') return true;
  return (CAPABILITY_ROLES[capability] as readonly string[]).includes(userRole);
}
