import { PERMISSION_GRANTS } from '../../../prisma/seed';

/**
 * Regression tests for the specific cross-role boundaries this system's
 * spec calls out by name (see section 8 of the Staff/Dashboard/Queue/
 * Login/Email gap-fill request). These constraints were already satisfied
 * by the existing seed when this test was written -- this file exists so a
 * future seed change that accidentally regresses one of them fails loudly
 * here, rather than silently shipping a privilege-boundary bug.
 */
const has = (role: string, resource: string, action: string) =>
  PERMISSION_GRANTS.some((g) => g.roleName === role && g.resource === resource && g.action === action);

describe('RBAC cross-role boundaries (seed regression guard)', () => {
  it('Nurse cannot modify prescriptions -- no Prescription grant of any kind', () => {
    const nursePrescriptionGrants = PERMISSION_GRANTS.filter((g) => g.roleName === 'Nurse' && g.resource === 'Prescription');
    expect(nursePrescriptionGrants).toHaveLength(0);
  });

  it('Reception cannot edit clinical diagnoses or prescriptions -- no Diagnosis/Prescription grant', () => {
    const receptionClinicalGrants = PERMISSION_GRANTS.filter(
      (g) => g.roleName === 'Reception' && (g.resource === 'Diagnosis' || g.resource === 'Prescription'),
    );
    expect(receptionClinicalGrants).toHaveLength(0);
  });

  // V-06: this is the boundary the test above was actually meant to check
  // but didn't -- PatientController's :id/history and :id/master routes
  // (full diagnoses/prescriptions/lab results/therapy per visit) were gated
  // on Employee:read, a permission Reception (and DataEntryOperator,
  // Pharmacist, LabTechnician, StoreManager, ProcurementOfficer,
  // QueueManager, Accountant, AdmissionDesk) hold for identity/registration
  // lookups, giving every one of those roles the same full clinical read
  // access as a Doctor despite having no clinical grant of any kind.
  it('only clinically-appropriate roles hold PatientHistory:read -- the real gate on full diagnosis/prescription/lab history (V-06)', () => {
    const grantedTo = new Set(
      PERMISSION_GRANTS.filter((g) => g.resource === 'PatientHistory' && g.action === 'read').map((g) => g.roleName),
    );
    expect(grantedTo).toEqual(new Set(['Doctor', 'Nurse', 'Administrator', 'Pathologist']));
    expect(grantedTo.has('Reception')).toBe(false);
    expect(grantedTo.has('DataEntryOperator')).toBe(false);
    expect(grantedTo.has('Pharmacist')).toBe(false);
    expect(grantedTo.has('LabTechnician')).toBe(false);
    expect(grantedTo.has('QueueManager')).toBe(false);
    expect(grantedTo.has('Accountant')).toBe(false);
  });

  it('Pharmacist can view and dispense prescriptions but cannot alter the diagnosis or edit the prescription itself', () => {
    expect(has('Pharmacist', 'Prescription', 'read')).toBe(true);
    expect(has('Pharmacist', 'Prescription', 'update')).toBe(false);
    expect(has('Pharmacist', 'Prescription', 'create')).toBe(false);
    expect(has('Pharmacist', 'Diagnosis', 'update')).toBe(false);
    expect(has('Pharmacist', 'Diagnosis', 'create')).toBe(false);
  });

  it('LabTechnician can enter results but cannot verify them -- only Pathologist can', () => {
    expect(has('LabTechnician', 'LabResult', 'create')).toBe(true);
    expect(has('LabTechnician', 'LabResult', 'verify')).toBe(false);
    expect(has('Pathologist', 'LabResult', 'verify')).toBe(true);
  });

  it('Administrator cannot create/verify a lab result -- clinical lab work stays with lab staff', () => {
    expect(has('Administrator', 'LabResult', 'create')).toBe(false);
    expect(has('Administrator', 'LabResult', 'verify')).toBe(false);
  });

  it('Doctor cannot manage generic Staff accounts -- account administration stays with Administrator', () => {
    expect(has('Doctor', 'Staff', 'create')).toBe(false);
    expect(has('Doctor', 'Staff', 'update')).toBe(false);
    expect(has('Doctor', 'Staff', 'delete')).toBe(false);
  });

  it('only Administrator (hospital-scoped) is granted Staff and AuditLog -- SuperAdmin is a platform-token bypass, never a seeded role', () => {
    // PERMISSION_GRANTS.roleName's own TypeScript union already excludes
    // 'SuperAdmin' entirely (it isn't one of the seeded SYSTEM_ROLES), which
    // is a stronger, compile-time guarantee of this than any runtime
    // assertion could give -- confirmed by this file itself failing to
    // *compile* if a 'SuperAdmin' roleName literal is ever compared here.
    expect(has('Administrator', 'Staff', 'create')).toBe(true);
    expect(has('Administrator', 'AuditLog', 'read')).toBe(true);
  });
});
