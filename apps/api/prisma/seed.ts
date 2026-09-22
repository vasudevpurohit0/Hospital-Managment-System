import { PrismaClient, EmploymentTypeCode, BenefitOutcome } from '@prisma/client';

const prisma = new PrismaClient();

export const SYSTEM_ROLES = [
  'Reception',
  'Doctor',
  'AdmissionDesk',
  'Nurse',
  'Pharmacist',
  'StoreManager',
  'ProcurementOfficer',
  'DataEntryOperator',
  'Administrator',
  'QueueManager',
  'LabTechnician',
  'Pathologist',
  'Accountant',
  // Read-only public waiting-area OPD display (a TV account). Sees the queue,
  // can change nothing -- its only permission grant is OPDVisit:read below.
  'OPDDisplayOperator',
  // Dedicated Therapy/Panchakarma staff -- runs the existing Therapy console
  // (perform/record sessions against doctor-created orders). Grants are the
  // therapy workflow plus the read-only lookups that screen needs, nothing
  // more (no admin/doctor scope).
  'THERAPY_STAFF',
] as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[number];

export interface PermissionGrant {
  roleName: SystemRoleName;
  resource: string;
  action: string;
}

// Every permission grant seeded into the database, keyed by role. This is
// the single source of truth for "who can do what" — the RBAC matrix test
// (src/common/guards/rbac-matrix.spec.ts) imports it directly rather than
// re-deriving it, so the two can never drift apart silently.
export const PERMISSION_GRANTS: PermissionGrant[] = [
  // --- DataEntryOperator (Demographic CRUD only) ---
  { roleName: 'DataEntryOperator', resource: 'Employee', action: 'create' },
  { roleName: 'DataEntryOperator', resource: 'Employee', action: 'read' },
  { roleName: 'DataEntryOperator', resource: 'Employee', action: 'update' },

  // --- Reception ---
  { roleName: 'Reception', resource: 'Employee', action: 'create' },
  { roleName: 'Reception', resource: 'Employee', action: 'read' },
  { roleName: 'Reception', resource: 'Employee', action: 'update' },
  { roleName: 'Reception', resource: 'HospitalUID', action: 'create' },
  { roleName: 'Reception', resource: 'HospitalUID', action: 'read' },
  { roleName: 'Reception', resource: 'Visit', action: 'create' },
  { roleName: 'Reception', resource: 'Visit', action: 'read' },
  { roleName: 'Reception', resource: 'OPDVisit', action: 'create' },
  { roleName: 'Reception', resource: 'OPDVisit', action: 'read' },
  // Front desk resolves queue issues (a patient in the wrong doctor's line,
  // a no-show that needs cancelling) without needing to call/start/complete
  // a consultation themselves.
  { roleName: 'Reception', resource: 'OPDVisit', action: 'cancel' },
  { roleName: 'Reception', resource: 'OPDVisit', action: 'transfer' },
  { roleName: 'Reception', resource: 'Charge', action: 'read' },
  { roleName: 'Reception', resource: 'Receipt', action: 'create' },
  { roleName: 'Reception', resource: 'Receipt', action: 'read' },
  // Reception assigns patients to a doctor at OPD registration (found
  // unauthenticated — GET/POST /doctors were @Public() — during the P8 RBAC audit).
  { roleName: 'Reception', resource: 'Doctor', action: 'read' },
  // Direct-Therapy patients (entry point 1) book at Registration with no
  // doctor involved — Reception needs to open/schedule that therapy
  // episode itself, though marking a session performed stays with Nurse.
  { roleName: 'Reception', resource: 'TherapySession', action: 'create' },
  { roleName: 'Reception', resource: 'TherapySession', action: 'read' },

  // --- Doctor ---
  { roleName: 'Doctor', resource: 'Employee', action: 'read' },
  // V-06: full clinical history (diagnoses/prescriptions/lab results/therapy)
  // is gated on this, not the identity-lookup-scoped Employee:read above --
  // see PatientController's :id/history and :id/master routes.
  { roleName: 'Doctor', resource: 'PatientHistory', action: 'read' },
  { roleName: 'Doctor', resource: 'Doctor', action: 'read' },
  { roleName: 'Doctor', resource: 'Visit', action: 'read' },
  // Lets a doctor start a fresh OPD visit for a patient found by search on
  // the Consultations screen when that patient has no open visit today —
  // e.g. an unscheduled follow-up — instead of sending them back to
  // Reception first just to get a token.
  { roleName: 'Doctor', resource: 'Visit', action: 'create' },
  { roleName: 'Doctor', resource: 'OPDVisit', action: 'read' },
  // Own queue only -- OpdService.assertOwnership rejects any of these
  // against a visit assigned to a different doctor, regardless of this grant.
  { roleName: 'Doctor', resource: 'OPDVisit', action: 'call' },
  { roleName: 'Doctor', resource: 'OPDVisit', action: 'update' },
  { roleName: 'Doctor', resource: 'OPDVisit', action: 'transfer' },
  { roleName: 'Doctor', resource: 'Diagnosis', action: 'create' },
  { roleName: 'Doctor', resource: 'Diagnosis', action: 'read' },
  { roleName: 'Doctor', resource: 'Prescription', action: 'create' },
  { roleName: 'Doctor', resource: 'Prescription', action: 'read' },
  { roleName: 'Doctor', resource: 'Prescription', action: 'sign' },
  { roleName: 'Doctor', resource: 'Admission', action: 'create' }, // Recommendation stub
  { roleName: 'Doctor', resource: 'Admission', action: 'read' },
  { roleName: 'Doctor', resource: 'Admission', action: 'approve' }, // Discharge approval
  // A doctor caring for an admitted (IPD) patient logs clinical observation/
  // treatment notes from Ward Console -- the same AdmissionNote workflow the
  // Nurse already has. Without this the "Log Observation Note" action 403s.
  { roleName: 'Doctor', resource: 'AdmissionNote', action: 'create' },
  { roleName: 'Doctor', resource: 'AdmissionNote', action: 'read' },
  { roleName: 'Doctor', resource: 'Charge', action: 'read' },
  // Read-only view of hospital medicine stock so the consultation screen can
  // offer real, in-stock medicines to prescribe (GET /inventory/medicines is
  // gated on MedicineBatch:read). Read only -- doctors never create, adjust,
  // dispense, or dispose stock; that stays with inventory/pharmacy roles.
  { roleName: 'Doctor', resource: 'MedicineBatch', action: 'read' },
  // A doctor orders investigations (Feature 6); lab staff never do.
  { roleName: 'Doctor', resource: 'LabTest', action: 'read' },
  { roleName: 'Doctor', resource: 'LabOrder', action: 'create' },
  { roleName: 'Doctor', resource: 'LabOrder', action: 'read' },
  { roleName: 'Doctor', resource: 'LabReport', action: 'read' },
  // A doctor orders/schedules therapy (Feature 7); a nurse marks it performed.
  { roleName: 'Doctor', resource: 'TherapySession', action: 'create' },
  { roleName: 'Doctor', resource: 'TherapySession', action: 'read' },
  // Self-service check-in/check-out/break toggle on the doctor's own
  // profile -- deliberately its own resource, not folded into Doctor:update
  // (admin-only, used for editing another doctor's profile), so a doctor can
  // toggle their own duty status without ever being granted the ability to
  // edit doctor profiles.
  { roleName: 'Doctor', resource: 'DoctorDuty', action: 'read' },
  { roleName: 'Doctor', resource: 'DoctorDuty', action: 'update' },

  // --- AdmissionDesk ---
  { roleName: 'AdmissionDesk', resource: 'Employee', action: 'read' },
  { roleName: 'AdmissionDesk', resource: 'Visit', action: 'read' },
  { roleName: 'AdmissionDesk', resource: 'Admission', action: 'create' },
  { roleName: 'AdmissionDesk', resource: 'Admission', action: 'read' },
  { roleName: 'AdmissionDesk', resource: 'Admission', action: 'update' },
  { roleName: 'AdmissionDesk', resource: 'Admission', action: 'transfer' },
  { roleName: 'AdmissionDesk', resource: 'Charge', action: 'read' },
  { roleName: 'AdmissionDesk', resource: 'Receipt', action: 'create' },
  { roleName: 'AdmissionDesk', resource: 'Receipt', action: 'read' },
  { roleName: 'AdmissionDesk', resource: 'Doctor', action: 'read' },

  // --- Nurse ---
  { roleName: 'Nurse', resource: 'Employee', action: 'read' },
  { roleName: 'Nurse', resource: 'PatientHistory', action: 'read' }, // V-06, see Doctor above
  { roleName: 'Nurse', resource: 'Doctor', action: 'read' },
  { roleName: 'Nurse', resource: 'Visit', action: 'read' },
  { roleName: 'Nurse', resource: 'Admission', action: 'read' },
  { roleName: 'Nurse', resource: 'Admission', action: 'transfer' },
  { roleName: 'Nurse', resource: 'AdmissionNote', action: 'create' },
  { roleName: 'Nurse', resource: 'AdmissionNote', action: 'read' },
  { roleName: 'Nurse', resource: 'Charge', action: 'read' },
  { roleName: 'Nurse', resource: 'TherapySession', action: 'read' },
  { roleName: 'Nurse', resource: 'TherapySession', action: 'update' }, // mark performed

  // --- Pharmacist ---
  { roleName: 'Pharmacist', resource: 'Employee', action: 'read' },
  { roleName: 'Pharmacist', resource: 'Prescription', action: 'read' },
  { roleName: 'Pharmacist', resource: 'StockTransaction', action: 'dispense' },
  { roleName: 'Pharmacist', resource: 'StockTransaction', action: 'read' },
  { roleName: 'Pharmacist', resource: 'MedicineBatch', action: 'read' },
  { roleName: 'Pharmacist', resource: 'Charge', action: 'read' },
  { roleName: 'Pharmacist', resource: 'Receipt', action: 'read' },
  { roleName: 'Pharmacist', resource: 'Billing', action: 'read' },

  // --- StoreManager ---
  { roleName: 'StoreManager', resource: 'Inventory', action: 'create' },
  { roleName: 'StoreManager', resource: 'Inventory', action: 'read' },
  { roleName: 'StoreManager', resource: 'Inventory', action: 'update' },
  { roleName: 'StoreManager', resource: 'Medicine', action: 'create' },
  { roleName: 'StoreManager', resource: 'Medicine', action: 'read' },
  { roleName: 'StoreManager', resource: 'Medicine', action: 'update' },
  { roleName: 'StoreManager', resource: 'MedicineBatch', action: 'create' },
  { roleName: 'StoreManager', resource: 'MedicineBatch', action: 'read' },
  { roleName: 'StoreManager', resource: 'MedicineBatch', action: 'update' },
  { roleName: 'StoreManager', resource: 'PurchaseRequisition', action: 'create' },
  { roleName: 'StoreManager', resource: 'PurchaseRequisition', action: 'read' },
  { roleName: 'StoreManager', resource: 'Approval', action: 'approve' },
  { roleName: 'StoreManager', resource: 'PurchaseOrder', action: 'create' },
  { roleName: 'StoreManager', resource: 'PurchaseOrder', action: 'read' },

  // --- ProcurementOfficer ---
  { roleName: 'ProcurementOfficer', resource: 'PurchaseRequisition', action: 'read' },
  { roleName: 'ProcurementOfficer', resource: 'Approval', action: 'approve' },
  { roleName: 'ProcurementOfficer', resource: 'PurchaseOrder', action: 'create' },
  { roleName: 'ProcurementOfficer', resource: 'PurchaseOrder', action: 'read' },
  // The Supply Chain screen is explicitly a shared "Store Manager &
  // Procurement Officer Workstation" that also does GRN and stock
  // transfer — without these, the officer's own screen fails to load
  // (GET /inventory/medicines needs MedicineBatch:read) and neither GRN
  // nor transfer action is reachable for this role at all.
  { roleName: 'ProcurementOfficer', resource: 'MedicineBatch', action: 'read' },
  { roleName: 'ProcurementOfficer', resource: 'MedicineBatch', action: 'create' },
  { roleName: 'ProcurementOfficer', resource: 'MedicineBatch', action: 'update' },

  // --- Administrator (hospital-wide operational & administrative privileges) ---
  { roleName: 'Administrator', resource: 'Employee', action: 'create' },
  { roleName: 'Administrator', resource: 'Employee', action: 'read' },
  { roleName: 'Administrator', resource: 'Employee', action: 'update' },
  { roleName: 'Administrator', resource: 'PatientHistory', action: 'read' }, // V-06, see Doctor above
  // Reclassification (post/grade/employment type) changes benefit
  // eligibility and pay-grade-linked billing, so it's kept narrower than
  // ordinary Employee:update (which Reception/DataEntryOperator also hold,
  // for demographic-only edits) -- see EmployeeController.update.
  { roleName: 'Administrator', resource: 'Employee', action: 'reclassify' },
  { roleName: 'Administrator', resource: 'Doctor', action: 'read' },
  // Onboarding a doctor creates a real login-capable account, so it is kept
  // to Administrator only, not handed to Reception/DataEntryOperator alongside
  // plain Employee:create.
  { roleName: 'Administrator', resource: 'Doctor', action: 'create' },
  { roleName: 'Administrator', resource: 'Doctor', action: 'update' },
  { roleName: 'Administrator', resource: 'Doctor', action: 'delete' },
  // Generic staff management (every role except Doctor, which is the
  // dedicated Doctor grant above) -- creating/locking/resetting a staff
  // login account, same reasoning as Doctor:create being Administrator-only.
  { roleName: 'Administrator', resource: 'Staff', action: 'create' },
  { roleName: 'Administrator', resource: 'Staff', action: 'read' },
  { roleName: 'Administrator', resource: 'Staff', action: 'update' },
  { roleName: 'Administrator', resource: 'Staff', action: 'delete' },
  // Secure user impersonation. A Super Admin needs no seed row here at all
  // (RbacGuard bypasses permission checks for a platform-type token
  // entirely) -- these two grants are what let a hospital-local
  // Administrator impersonate their own hospital's staff/doctors.
  // AccountLifecycleService.impersonate() separately refuses an
  // Administrator-type actor targeting another Administrator, so this grant
  // alone does not let one Hospital Admin impersonate another.
  { roleName: 'Administrator', resource: 'Staff', action: 'impersonate' },
  { roleName: 'Administrator', resource: 'Doctor', action: 'impersonate' },
  { roleName: 'Administrator', resource: 'HospitalUID', action: 'create' },
  { roleName: 'Administrator', resource: 'HospitalUID', action: 'read' },
  { roleName: 'Administrator', resource: 'Inventory', action: 'create' },
  { roleName: 'Administrator', resource: 'Inventory', action: 'read' },
  { roleName: 'Administrator', resource: 'Inventory', action: 'update' },
  { roleName: 'Administrator', resource: 'FacilityEligibilityRule', action: 'create' },
  { roleName: 'Administrator', resource: 'FacilityEligibilityRule', action: 'read' },
  { roleName: 'Administrator', resource: 'FacilityEligibilityRule', action: 'update' },
  { roleName: 'Administrator', resource: 'BenefitRule', action: 'create' },
  { roleName: 'Administrator', resource: 'BenefitRule', action: 'read' },
  { roleName: 'Administrator', resource: 'BenefitRule', action: 'update' },
  { roleName: 'Administrator', resource: 'AuditLog', action: 'read' },
  { roleName: 'Administrator', resource: 'Department', action: 'read' },
  { roleName: 'Administrator', resource: 'Department', action: 'create' },
  { roleName: 'Administrator', resource: 'Department', action: 'update' },
  { roleName: 'Administrator', resource: 'Department', action: 'delete' },
  { roleName: 'Administrator', resource: 'HospitalSettings', action: 'read' },
  { roleName: 'Administrator', resource: 'HospitalSettings', action: 'update' },
  { roleName: 'Administrator', resource: 'Visit', action: 'create' },
  { roleName: 'Administrator', resource: 'Visit', action: 'read' },
  { roleName: 'Administrator', resource: 'Visit', action: 'update' },
  { roleName: 'Administrator', resource: 'OPDVisit', action: 'create' },
  { roleName: 'Administrator', resource: 'OPDVisit', action: 'read' },
  { roleName: 'Administrator', resource: 'OPDVisit', action: 'call' },
  { roleName: 'Administrator', resource: 'OPDVisit', action: 'update' },
  { roleName: 'Administrator', resource: 'OPDVisit', action: 'cancel' },
  { roleName: 'Administrator', resource: 'OPDVisit', action: 'transfer' },
  { roleName: 'Administrator', resource: 'Diagnosis', action: 'create' },
  { roleName: 'Administrator', resource: 'Diagnosis', action: 'read' },
  { roleName: 'Administrator', resource: 'Diagnosis', action: 'update' },
  { roleName: 'Administrator', resource: 'Prescription', action: 'create' },
  { roleName: 'Administrator', resource: 'Prescription', action: 'read' },
  { roleName: 'Administrator', resource: 'Prescription', action: 'update' },
  { roleName: 'Administrator', resource: 'Prescription', action: 'sign' },
  { roleName: 'Administrator', resource: 'Admission', action: 'create' },
  { roleName: 'Administrator', resource: 'Admission', action: 'read' },
  { roleName: 'Administrator', resource: 'Admission', action: 'update' },
  { roleName: 'Administrator', resource: 'Admission', action: 'approve' },
  { roleName: 'Administrator', resource: 'Admission', action: 'transfer' },
  { roleName: 'Administrator', resource: 'AdmissionNote', action: 'create' },
  { roleName: 'Administrator', resource: 'AdmissionNote', action: 'read' },
  { roleName: 'Administrator', resource: 'Medicine', action: 'create' },
  { roleName: 'Administrator', resource: 'Medicine', action: 'read' },
  { roleName: 'Administrator', resource: 'Medicine', action: 'update' },
  { roleName: 'Administrator', resource: 'MedicineBatch', action: 'create' },
  { roleName: 'Administrator', resource: 'MedicineBatch', action: 'read' },
  { roleName: 'Administrator', resource: 'MedicineBatch', action: 'update' },
  { roleName: 'Administrator', resource: 'StockTransaction', action: 'create' },
  { roleName: 'Administrator', resource: 'StockTransaction', action: 'read' },
  { roleName: 'Administrator', resource: 'StockTransaction', action: 'dispense' },
  { roleName: 'Administrator', resource: 'PurchaseRequisition', action: 'create' },
  { roleName: 'Administrator', resource: 'PurchaseRequisition', action: 'read' },
  { roleName: 'Administrator', resource: 'PurchaseOrder', action: 'create' },
  { roleName: 'Administrator', resource: 'PurchaseOrder', action: 'read' },
  { roleName: 'Administrator', resource: 'Approval', action: 'approve' },
  // Administrator no longer bypasses the RbacGuard (only the platform Super
  // Admin does, via type: 'platform' -- see RbacGuard), so every endpoint it
  // must reach needs an explicit grant. These two were previously reachable
  // only through that bypass.
  { roleName: 'Administrator', resource: 'Billing', action: 'read' },
  { roleName: 'Administrator', resource: 'BrandingConfig', action: 'update' },
  // Service catalogue and pricing. Setting a rate is an administrative act:
  // no operational role holds ServicePrice:create, so the staff who bill a
  // service cannot decide what it costs.
  { roleName: 'Administrator', resource: 'Service', action: 'create' },
  { roleName: 'Administrator', resource: 'Service', action: 'read' },
  { roleName: 'Administrator', resource: 'Service', action: 'update' },
  { roleName: 'Administrator', resource: 'ServicePrice', action: 'create' },
  { roleName: 'Administrator', resource: 'ServicePrice', action: 'read' },
  // The unified charge ledger and receipting (Phase 2). Administrator gets
  // full oversight and can act as a payment-collection backstop; setting a
  // rate (ServicePrice above) remains the only pricing-adjacent action a
  // charge-issuing role never receives.
  { roleName: 'Administrator', resource: 'Charge', action: 'read' },
  { roleName: 'Administrator', resource: 'Charge', action: 'create' },
  { roleName: 'Administrator', resource: 'Charge', action: 'cancel' },
  { roleName: 'Administrator', resource: 'Receipt', action: 'create' },
  { roleName: 'Administrator', resource: 'Receipt', action: 'read' },
  // Oversight of the laboratory: configuration and read-only visibility.
  // Administrator deliberately cannot enter or verify a clinical result.
  { roleName: 'Administrator', resource: 'LabTest', action: 'create' },
  { roleName: 'Administrator', resource: 'LabTest', action: 'read' },
  { roleName: 'Administrator', resource: 'LabTest', action: 'update' },
  { roleName: 'Administrator', resource: 'LabOrder', action: 'create' },
  { roleName: 'Administrator', resource: 'LabOrder', action: 'read' },
  { roleName: 'Administrator', resource: 'LabReport', action: 'read' },
  { roleName: 'Administrator', resource: 'TherapySession', action: 'read' },
  // Administrator can also book a Direct-Therapy episode at Registration,
  // same non-clinical booking capability as Reception.
  { roleName: 'Administrator', resource: 'TherapySession', action: 'create' },
  // ...and manage those sessions from the Therapy console (mark performed /
  // cancel). Without this update grant the console's action buttons stay
  // hidden for an Administrator, who could book a session but never act on
  // it. Mirrors the therapy:markPerformed capability on the frontend.
  { roleName: 'Administrator', resource: 'TherapySession', action: 'update' },
  // Feature 12/13: analytics and the report centre are administrative
  // oversight, not clinical or operational action.
  { roleName: 'Administrator', resource: 'Analytics', action: 'read' },
  { roleName: 'Administrator', resource: 'Report', action: 'generate' },
  { roleName: 'Administrator', resource: 'RbacConfig', action: 'read' },
  { roleName: 'Administrator', resource: 'RbacConfig', action: 'update' },

  // --- Service catalogue read access ---
  // Ordering or billing a service requires knowing it exists and what it
  // costs. None of these roles may create or change a rate.
  { roleName: 'Doctor', resource: 'Service', action: 'read' },
  { roleName: 'Reception', resource: 'Service', action: 'read' },
  { roleName: 'Nurse', resource: 'Service', action: 'read' },
  { roleName: 'AdmissionDesk', resource: 'Service', action: 'read' },
  { roleName: 'Pharmacist', resource: 'Service', action: 'read' },
  { roleName: 'LabTechnician', resource: 'Service', action: 'read' },
  { roleName: 'Pathologist', resource: 'Service', action: 'read' },

  // --- LabTechnician (accessions samples and enters results) ---
  // Deliberately cannot verify or release: a technician's entry is never the
  // final report. Enforced here and in the laboratory service layer.
  { roleName: 'LabTechnician', resource: 'Employee', action: 'read' },
  { roleName: 'LabTechnician', resource: 'Visit', action: 'read' },
  { roleName: 'LabTechnician', resource: 'LabTest', action: 'read' },
  { roleName: 'LabTechnician', resource: 'LabOrder', action: 'read' },
  { roleName: 'LabTechnician', resource: 'LabOrder', action: 'update' },
  { roleName: 'LabTechnician', resource: 'LabSample', action: 'create' },
  { roleName: 'LabTechnician', resource: 'LabSample', action: 'read' },
  { roleName: 'LabTechnician', resource: 'LabResult', action: 'create' },
  { roleName: 'LabTechnician', resource: 'LabResult', action: 'read' },
  { roleName: 'LabTechnician', resource: 'LabResult', action: 'update' },
  { roleName: 'LabTechnician', resource: 'LabReport', action: 'read' },

  // --- Pathologist (verifies results and releases reports) ---
  { roleName: 'Pathologist', resource: 'Employee', action: 'read' },
  { roleName: 'Pathologist', resource: 'PatientHistory', action: 'read' }, // V-06, see Doctor above
  { roleName: 'Pathologist', resource: 'Visit', action: 'read' },
  { roleName: 'Pathologist', resource: 'LabTest', action: 'read' },
  { roleName: 'Pathologist', resource: 'LabTest', action: 'update' },
  { roleName: 'Pathologist', resource: 'LabOrder', action: 'read' },
  { roleName: 'Pathologist', resource: 'LabOrder', action: 'update' },
  { roleName: 'Pathologist', resource: 'LabSample', action: 'create' },
  { roleName: 'Pathologist', resource: 'LabSample', action: 'read' },
  { roleName: 'Pathologist', resource: 'LabResult', action: 'create' },
  { roleName: 'Pathologist', resource: 'LabResult', action: 'read' },
  { roleName: 'Pathologist', resource: 'LabResult', action: 'update' },
  { roleName: 'Pathologist', resource: 'LabResult', action: 'verify' },
  { roleName: 'Pathologist', resource: 'LabReport', action: 'create' },
  { roleName: 'Pathologist', resource: 'LabReport', action: 'read' },
  { roleName: 'Pathologist', resource: 'LabReport', action: 'release' },

  // --- QueueManager (OPD Queue operations) ---
  { roleName: 'QueueManager', resource: 'Employee', action: 'read' },
  { roleName: 'QueueManager', resource: 'Doctor', action: 'read' },
  { roleName: 'QueueManager', resource: 'Visit', action: 'read' },
  { roleName: 'QueueManager', resource: 'OPDVisit', action: 'read' },
  { roleName: 'QueueManager', resource: 'OPDVisit', action: 'call' },
  { roleName: 'QueueManager', resource: 'OPDVisit', action: 'update' },
  { roleName: 'QueueManager', resource: 'OPDVisit', action: 'cancel' },
  { roleName: 'QueueManager', resource: 'OPDVisit', action: 'transfer' },

  // --- OPD Display Operator (public waiting-area TV) ---
  // Exactly one grant: read the OPD queue. No call/skip/no-show/transfer/
  // cancel/update/create -- the account physically cannot mutate the queue,
  // enforced by the backend RbacGuard, not merely by hiding buttons. It backs
  // the read-only OpdDisplayController (GET /opd-display/*, all OPDVisit:read).
  { roleName: 'OPDDisplayOperator', resource: 'OPDVisit', action: 'read' },

  // --- Therapy / Panchakarma Staff ---
  // Exactly the permissions the existing Therapy console (TherapyConsoleScreen
  // + TherapyController) exercises, and no more. The therapy workflow:
  { roleName: 'THERAPY_STAFF', resource: 'TherapySession', action: 'read' },
  { roleName: 'THERAPY_STAFF', resource: 'TherapySession', action: 'create' },
  { roleName: 'THERAPY_STAFF', resource: 'TherapySession', action: 'update' },
  // Read-only lookups that screen relies on: the therapy service catalogue,
  // and the OPD visit / IPD admission context behind an order (the therapy
  // session/course payload already embeds the patient, so no Employee/patient
  // directory access is needed -- kept deliberately narrow). Doctor-created
  // OPD/IPD therapy orders are the source and remain read-only here.
  { roleName: 'THERAPY_STAFF', resource: 'Service', action: 'read' },
  { roleName: 'THERAPY_STAFF', resource: 'Visit', action: 'read' },
  { roleName: 'THERAPY_STAFF', resource: 'Admission', action: 'read' },

  // --- Accountant (billing read/create, limited employee/visit read -- no
  // clinical, pharmacy, inventory or admin access) ---
  { roleName: 'Accountant', resource: 'Employee', action: 'read' },
  { roleName: 'Accountant', resource: 'Visit', action: 'read' },
  { roleName: 'Accountant', resource: 'Billing', action: 'read' },
  { roleName: 'Accountant', resource: 'Charge', action: 'read' },
  { roleName: 'Accountant', resource: 'Charge', action: 'create' },
  { roleName: 'Accountant', resource: 'Receipt', action: 'read' },
  { roleName: 'Accountant', resource: 'Receipt', action: 'create' },
];

export async function main() {
  console.log('🌱 Starting database seed...');

  // 1. Seed System Roles & Permissions
  const roleMap: Record<string, string> = {};

  for (const roleName of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: { isSystemRole: true },
      create: {
        name: roleName,
        isSystemRole: true,
      },
    });

    roleMap[roleName] = role.id;
    console.log(`  ✓ Role: ${roleName} (${role.id})`);
  }

  // 2. Define Permissions per Role
  // DataEntryOperator is strictly scoped to Employee create/update only (FR-SEC-13)
  const permissionsData = PERMISSION_GRANTS;

  for (const perm of permissionsData) {
    const roleId = roleMap[perm.roleName];
    await prisma.permission.upsert({
      where: {
        roleId_resource_action: {
          roleId,
          resource: perm.resource,
          action: perm.action,
        },
      },
      update: {},
      create: {
        roleId,
        resource: perm.resource,
        action: perm.action,
      },
    });
  }
  console.log(`  ✓ Seeded permissions for all ${SYSTEM_ROLES.length} roles`);

  // 3. Seed Employment Types
  const permanentType = await prisma.employmentType.upsert({
    where: { code: EmploymentTypeCode.PERMANENT },
    update: {},
    create: {
      code: EmploymentTypeCode.PERMANENT,
      name: 'Permanent Employee',
    },
  });

  const contractualType = await prisma.employmentType.upsert({
    where: { code: EmploymentTypeCode.CONTRACTUAL },
    update: {},
    create: {
      code: EmploymentTypeCode.CONTRACTUAL,
      name: 'Contractual Employee',
    },
  });
  console.log(`  ✓ Seeded EmploymentTypes: Permanent & Contractual`);

  // 3b. Seed default BenefitRules (spec §7). Moved here from
  // BenefitRuleService.onModuleInit(): that ran once at app-process boot
  // against "the" database, which no longer makes sense once each hospital
  // has its own schema (there's no single database to auto-seed into at
  // process start anymore). This runs once per tenant schema instead, right
  // alongside every other per-tenant default this script seeds -- both for
  // the initial cutover and for every hospital onboarded afterward via
  // `prisma db seed` against that hospital's schema.
  const existingContractualRule = await prisma.benefitRule.findFirst({
    where: { employmentTypeId: contractualType.id, medicineCategory: null },
  });
  if (!existingContractualRule) {
    await prisma.benefitRule.create({
      data: {
        employmentTypeId: contractualType.id,
        medicineCategory: null,
        outcome: BenefitOutcome.PAID,
        active: true,
        version: 1,
      },
    });
  }

  const existingPermanentRule = await prisma.benefitRule.findFirst({
    where: { employmentTypeId: permanentType.id, medicineCategory: null },
  });
  if (!existingPermanentRule) {
    await prisma.benefitRule.create({
      data: {
        employmentTypeId: permanentType.id,
        medicineCategory: null,
        outcome: BenefitOutcome.COVERED,
        active: true,
        version: 1,
      },
    });
  }
  console.log(`  ✓ Seeded default BenefitRules: CONTRACTUAL -> PAID, PERMANENT -> COVERED`);

  // 4. Seed Posts & Grades
  const seniorOfficerPost = await prisma.post.upsert({
    where: { title: 'Senior Officer' },
    update: {},
    create: { title: 'Senior Officer' },
  });

  const officerPost = await prisma.post.upsert({
    where: { title: 'Officer' },
    update: {},
    create: { title: 'Officer' },
  });

  const clerkPost = await prisma.post.upsert({
    where: { title: 'Clerk' },
    update: {},
    create: { title: 'Clerk' },
  });

  const assistantPost = await prisma.post.upsert({
    where: { title: 'Assistant' },
    update: {},
    create: { title: 'Assistant' },
  });

  const supportStaffPost = await prisma.post.upsert({
    where: { title: 'Support Staff' },
    update: {},
    create: { title: 'Support Staff' },
  });

  const contractWorkerPost = await prisma.post.upsert({
    where: { title: 'Contract Worker' },
    update: {},
    create: { title: 'Contract Worker' },
  });

  await prisma.grade.upsert({
    where: { id: '00000000-0000-0000-0000-000000000010' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      payLevel: 'Pay Level 10',
      postId: seniorOfficerPost.id,
    },
  });

  await prisma.grade.upsert({
    where: { id: '00000000-0000-0000-0000-000000000007' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000007',
      payLevel: 'Pay Level 7',
      postId: officerPost.id,
    },
  });

  await prisma.grade.upsert({
    where: { id: '00000000-0000-0000-0000-000000000004' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000004',
      payLevel: 'Pay Level 4',
      postId: clerkPost.id,
    },
  });

  await prisma.grade.upsert({
    where: { id: '00000000-0000-0000-0000-000000000003' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000003',
      payLevel: 'Pay Level 3',
      postId: assistantPost.id,
    },
  });

  await prisma.grade.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      payLevel: 'Pay Level 1',
      postId: supportStaffPost.id,
    },
  });

  await prisma.grade.upsert({
    where: { id: '00000000-0000-0000-0000-000000000099' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000099',
      payLevel: 'Contractual Grade',
      postId: contractWorkerPost.id,
    },
  });

  console.log(`  ✓ Seeded sample Posts & Grades`);

  console.log('✅ Seed completed successfully!');
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error('❌ Seed error:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
