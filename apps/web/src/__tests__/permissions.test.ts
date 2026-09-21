import { describe, it, expect } from 'vitest';
import { can, type Capability } from '../lib/permissions';

/**
 * The Laboratory workbench once gated "Collect Sample" on an inline
 * `userRole === 'LabTechnician' || userRole === 'Pathologist'`. SuperAdmin
 * bypasses every check in the server's RbacGuard and the sidebar routes it to
 * that screen, so the order sat at ORDERED with no control able to advance it —
 * the workflow dead-ended at sample collection.
 *
 * These lock the two properties that prevent that from recurring: SuperAdmin is
 * never filtered out, and each capability names exactly the roles the API seed
 * grants it.
 */

const ALL_CAPABILITIES: Capability[] = [
  'lab:collectSample',
  'lab:enterResults',
  'lab:verifyReport',
  'therapy:order',
  'therapy:markPerformed',
];

describe('client RBAC mirror', () => {
  it('never hides an action from SuperAdmin', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(can('SuperAdmin', capability)).toBe(true);
    }
  });

  it('denies every capability to an unauthenticated or unknown role', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(can(undefined, capability)).toBe(false);
      expect(can(null, capability)).toBe(false);
      expect(can('', capability)).toBe(false);
      expect(can('StoreManager', capability)).toBe(false);
    }
  });

  // Mirrors PERMISSION_GRANTS in apps/api/prisma/seed.ts. If a grant changes
  // there, this must change with it.
  it.each([
    // capability,                allowed,                                    denied
    ['lab:collectSample', ['LabTechnician', 'Pathologist'], ['Doctor', 'Nurse', 'Administrator']],
    ['lab:enterResults', ['LabTechnician', 'Pathologist'], ['Doctor', 'Administrator']],
    ['lab:verifyReport', ['Pathologist'], ['LabTechnician', 'Doctor', 'Administrator']],
    ['therapy:order', ['Doctor', 'Reception', 'Administrator'], ['Nurse', 'LabTechnician']],
    ['therapy:markPerformed', ['Nurse', 'Administrator'], ['Doctor', 'Reception']],
  ] as [Capability, string[], string[]][])(
    '%s matches the seeded grant',
    (capability, allowed, denied) => {
      for (const role of allowed) expect(can(role, capability)).toBe(true);
      for (const role of denied) expect(can(role, capability)).toBe(false);
    },
  );
});
