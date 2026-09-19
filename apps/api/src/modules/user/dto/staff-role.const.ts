/**
 * Every seeded Role except Doctor -- Doctor keeps its own dedicated
 * DoctorService/DoctorController/DoctorSchedulePage stack (already built,
 * tested, and in production use); this generic Staff module intentionally
 * covers everyone else so that stack is never put at risk of regression.
 *
 * Prefixes back DocumentSequenceService.nextStaffId(prefix) -- e.g.
 * NUR-0001. Doctor's own creation flow uses nextStaffId('DOC') directly,
 * without being a member of this list.
 */
export const STAFF_ROLE_PREFIXES = {
  Reception: 'REC',
  AdmissionDesk: 'ADM',
  Nurse: 'NUR',
  Pharmacist: 'PHA',
  StoreManager: 'STO',
  ProcurementOfficer: 'PRO',
  DataEntryOperator: 'DEO',
  Administrator: 'ADX',
  QueueManager: 'QUE',
  LabTechnician: 'LAB',
  Pathologist: 'PTH',
  Accountant: 'ACC',
} as const;

export type StaffRoleName = keyof typeof STAFF_ROLE_PREFIXES;

export const STAFF_ROLE_NAMES = Object.keys(STAFF_ROLE_PREFIXES) as StaffRoleName[];
