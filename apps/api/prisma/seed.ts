import {
  PrismaClient,
  EmploymentTypeCode,
  FacilityCategory,
  RoomType,
  BedStatus,
  BenefitOutcome,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { seedCatalog } from './seeds/catalog.seed';
import { seedLabCatalog } from './seeds/lab-catalog.seed';
import { SEED_DEPARTMENTS } from '../src/modules/opd/services/department.service';
import { DEFAULT_BRANDING } from '../src/modules/auth/branding.controller';
import { DEFAULT_HOSPITAL_SETTINGS } from '../src/modules/auth/hospital-settings.controller';

const prisma = new PrismaClient();

// Login identifiers must now be unique across the WHOLE platform (the
// unified single-login directory, see LoginDirectoryService), not just
// within one hospital's schema. Every demo account this script creates used
// to hardcode the exact same @esic.gov.in address for every hospital it
// seeded, which is exactly what the directory now rejects as a collision the
// moment a second hospital is onboarded. Deriving a per-tenant tag from the
// schema this script is actually running against (read straight from
// DATABASE_URL's `schema` query param, the same value the onboarding flow
// already passes in) keeps every hospital's demo logins distinct without
// having to invent a naming convention per hospital by hand.
const TENANT_TAG = (() => {
  try {
    const schema = new URL(process.env.DATABASE_URL || '').searchParams.get('schema');
    return schema ? schema.replace(/^hospital_/, '').replace(/_/g, '-') : 'default';
  } catch {
    return 'default';
  }
})();

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
  { roleName: 'Doctor', resource: 'Charge', action: 'read' },
  // A doctor orders investigations (Feature 6); lab staff never do.
  { roleName: 'Doctor', resource: 'LabTest', action: 'read' },
  { roleName: 'Doctor', resource: 'LabOrder', action: 'create' },
  { roleName: 'Doctor', resource: 'LabOrder', action: 'read' },
  { roleName: 'Doctor', resource: 'LabReport', action: 'read' },
  // A doctor orders/schedules therapy (Feature 7); a nurse marks it performed.
  { roleName: 'Doctor', resource: 'TherapySession', action: 'create' },
  { roleName: 'Doctor', resource: 'TherapySession', action: 'read' },

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

  const grade10 = await prisma.grade.upsert({
    where: { id: '00000000-0000-0000-0000-000000000010' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      payLevel: 'Pay Level 10',
      postId: seniorOfficerPost.id,
    },
  });

  const grade7 = await prisma.grade.upsert({
    where: { id: '00000000-0000-0000-0000-000000000007' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000007',
      payLevel: 'Pay Level 7',
      postId: officerPost.id,
    },
  });

  const grade4 = await prisma.grade.upsert({
    where: { id: '00000000-0000-0000-0000-000000000004' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000004',
      payLevel: 'Pay Level 4',
      postId: clerkPost.id,
    },
  });

  const grade3 = await prisma.grade.upsert({
    where: { id: '00000000-0000-0000-0000-000000000003' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000003',
      payLevel: 'Pay Level 3',
      postId: assistantPost.id,
    },
  });

  const grade1 = await prisma.grade.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      payLevel: 'Pay Level 1',
      postId: supportStaffPost.id,
    },
  });

  const gradeContractual = await prisma.grade.upsert({
    where: { id: '00000000-0000-0000-0000-000000000099' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000099',
      payLevel: 'Contractual Grade',
      postId: contractWorkerPost.id,
    },
  });

  console.log(`  ✓ Seeded sample Posts & Grades`);

  // Seed Wards
  const privateWard = await prisma.ward.upsert({
    where: { id: '00000000-0000-0000-0000-000000000101' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000101',
      name: 'Private Ward',
      category: FacilityCategory.A,
    },
  });

  const semiPrivateWard = await prisma.ward.upsert({
    where: { id: '00000000-0000-0000-0000-000000000102' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000102',
      name: 'Semi-Private Ward',
      category: FacilityCategory.B,
    },
  });

  const generalWardC = await prisma.ward.upsert({
    where: { id: '00000000-0000-0000-0000-000000000103' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000103',
      name: 'General Ward C',
      category: FacilityCategory.C,
    },
  });

  const generalWardD = await prisma.ward.upsert({
    where: { id: '00000000-0000-0000-0000-000000000104' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000104',
      name: 'General Ward D',
      category: FacilityCategory.D,
    },
  });

  const contractualWard = await prisma.ward.upsert({
    where: { id: '00000000-0000-0000-0000-000000000105' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000105',
      name: 'Policy Based Ward',
      category: FacilityCategory.CONTRACTUAL,
    },
  });

  console.log(`  ✓ Seeded Wards`);

  // Seed Rooms
  const singleRoom = await prisma.room.upsert({
    where: { id: '00000000-0000-0000-0000-000000000201' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000201',
      wardId: privateWard.id,
      roomNumber: 'Single-101',
      type: RoomType.SINGLE,
    },
  });

  const sharedRoom = await prisma.room.upsert({
    where: { id: '00000000-0000-0000-0000-000000000202' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000202',
      wardId: semiPrivateWard.id,
      roomNumber: 'Shared-201',
      type: RoomType.SHARED,
    },
  });

  const generalRoomC = await prisma.room.upsert({
    where: { id: '00000000-0000-0000-0000-000000000203' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000203',
      wardId: generalWardC.id,
      roomNumber: 'General-301',
      type: RoomType.GENERAL,
    },
  });

  const generalRoomD = await prisma.room.upsert({
    where: { id: '00000000-0000-0000-0000-000000000204' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000204',
      wardId: generalWardD.id,
      roomNumber: 'General-401',
      type: RoomType.GENERAL,
    },
  });

  const contractualRoom = await prisma.room.upsert({
    where: { id: '00000000-0000-0000-0000-000000000205' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000205',
      wardId: contractualWard.id,
      roomNumber: 'Contract-501',
      type: RoomType.GENERAL,
    },
  });

  console.log(`  ✓ Seeded Rooms`);

  // Seed Beds
  await prisma.bed.upsert({
    where: { id: '00000000-0000-0000-0000-000000000301' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000301',
      roomId: singleRoom.id,
      bedNumber: 'A1',
      status: BedStatus.AVAILABLE,
    },
  });

  await prisma.bed.upsert({
    where: { id: '00000000-0000-0000-0000-000000000302' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000302',
      roomId: sharedRoom.id,
      bedNumber: 'B1',
      status: BedStatus.AVAILABLE,
    },
  });

  await prisma.bed.upsert({
    where: { id: '00000000-0000-0000-0000-000000000303' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000303',
      roomId: generalRoomC.id,
      bedNumber: 'C1',
      status: BedStatus.AVAILABLE,
    },
  });

  await prisma.bed.upsert({
    where: { id: '00000000-0000-0000-0000-000000000304' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000304',
      roomId: generalRoomD.id,
      bedNumber: 'D1',
      status: BedStatus.AVAILABLE,
    },
  });

  await prisma.bed.upsert({
    where: { id: '00000000-0000-0000-0000-000000000305' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000305',
      roomId: contractualRoom.id,
      bedNumber: 'E1',
      status: BedStatus.AVAILABLE,
    },
  });

  console.log(`  ✓ Seeded Beds`);

  // Seed FacilityEligibilityRules mapping Post -> Category -> Ward -> Room -> Facility level
  const rules = [
    {
      id: '00000000-0000-0000-0000-000000000401',
      postId: seniorOfficerPost.id,
      category: FacilityCategory.A,
      wardEligibility: 'Private Ward',
      room: 'Single Room',
      facilityLevel: 'Premium',
    },
    {
      id: '00000000-0000-0000-0000-000000000402',
      postId: officerPost.id,
      category: FacilityCategory.B,
      wardEligibility: 'Semi-Private',
      room: 'Shared Room',
      facilityLevel: 'Enhanced',
    },
    {
      id: '00000000-0000-0000-0000-000000000403',
      postId: clerkPost.id,
      category: FacilityCategory.C,
      wardEligibility: 'General Ward',
      room: 'General Bed',
      facilityLevel: 'Standard',
    },
    {
      id: '00000000-0000-0000-0000-000000000404',
      postId: assistantPost.id,
      category: FacilityCategory.C,
      wardEligibility: 'General Ward',
      room: 'General Bed',
      facilityLevel: 'Standard',
    },
    {
      id: '00000000-0000-0000-0000-000000000405',
      postId: supportStaffPost.id,
      category: FacilityCategory.D,
      wardEligibility: 'General Ward',
      room: 'General Bed',
      facilityLevel: 'Standard',
    },
    {
      id: '00000000-0000-0000-0000-000000000406',
      postId: contractWorkerPost.id,
      category: FacilityCategory.CONTRACTUAL,
      wardEligibility: 'Policy Based',
      room: 'General / Policy Based',
      facilityLevel: 'Limited',
    },
  ];

  for (const rule of rules) {
    const existingRule = await prisma.facilityEligibilityRule.findFirst({
      where: { postId: rule.postId, active: true },
    });
    if (!existingRule) {
      await prisma.facilityEligibilityRule.create({
        data: {
          id: rule.id,
          postId: rule.postId,
          category: rule.category,
          wardEligibility: rule.wardEligibility,
          room: rule.room,
          facilityLevel: rule.facilityLevel,
          active: true,
          version: 1,
        },
      });
    }
  }

  console.log(`  ✓ Seeded FacilityEligibilityRules`);

  // 5. Seed Users
  //
  // No SuperAdmin user is seeded here: the hospital-local SuperAdmin role is
  // retired now that cross-hospital access is a real platform-level concept
  // (see PlatformUser / apps/api/prisma/platform/seed.ts, which seeds the
  // global Super Admin instead).
  const doctorPasswordHash = await bcrypt.hash('DoctorPass123!', 10);
  const doctorUser = await prisma.user.upsert({
    where: { identifier: `doctor@${TENANT_TAG}.esic.gov.in` },
    update: {
      passwordHash: doctorPasswordHash,
      roleId: roleMap['Doctor'],
      active: true,
    },
    create: {
      identifier: `doctor@${TENANT_TAG}.esic.gov.in`,
      passwordHash: doctorPasswordHash,
      roleId: roleMap['Doctor'],
      active: true,
    },
  });

  console.log(`  ✓ Seeded Doctor user: doctor@${TENANT_TAG}.esic.gov.in (${doctorUser.id})`);

  const nursePasswordHash = await bcrypt.hash('NursePass123!', 10);
  const nurseUser = await prisma.user.upsert({
    where: { identifier: `nurse@${TENANT_TAG}.esic.gov.in` },
    update: {
      passwordHash: nursePasswordHash,
      roleId: roleMap['Nurse'],
      active: true,
    },
    create: {
      identifier: `nurse@${TENANT_TAG}.esic.gov.in`,
      passwordHash: nursePasswordHash,
      roleId: roleMap['Nurse'],
      active: true,
    },
  });

  console.log(`  ✓ Seeded Nurse user: nurse@${TENANT_TAG}.esic.gov.in (${nurseUser.id})`);

  const admissionPasswordHash = await bcrypt.hash('AdmissionPass123!', 10);
  const admissionUser = await prisma.user.upsert({
    where: { identifier: `admission@${TENANT_TAG}.esic.gov.in` },
    update: {
      passwordHash: admissionPasswordHash,
      roleId: roleMap['AdmissionDesk'],
      active: true,
    },
    create: {
      identifier: `admission@${TENANT_TAG}.esic.gov.in`,
      passwordHash: admissionPasswordHash,
      roleId: roleMap['AdmissionDesk'],
      active: true,
    },
  });

  console.log(
    `  ✓ Seeded AdmissionDesk user: admission@${TENANT_TAG}.esic.gov.in (${admissionUser.id})`,
  );

  const adminPasswordHash = await bcrypt.hash('AdminPass123!', 10);
  const adminUser = await prisma.user.upsert({
    where: { identifier: `admin@${TENANT_TAG}.esic.gov.in` },
    update: {
      passwordHash: adminPasswordHash,
      roleId: roleMap['Administrator'],
      active: true,
    },
    create: {
      identifier: `admin@${TENANT_TAG}.esic.gov.in`,
      passwordHash: adminPasswordHash,
      roleId: roleMap['Administrator'],
      active: true,
    },
  });

  console.log(`  ✓ Seeded Administrator user: admin@${TENANT_TAG}.esic.gov.in (${adminUser.id})`);

  const pharmacistPasswordHash = await bcrypt.hash('PharmacistPass123!', 10);
  const pharmacistUser = await prisma.user.upsert({
    where: { identifier: `pharmacist@${TENANT_TAG}.esic.gov.in` },
    update: {
      passwordHash: pharmacistPasswordHash,
      roleId: roleMap['Pharmacist'],
      active: true,
    },
    create: {
      identifier: `pharmacist@${TENANT_TAG}.esic.gov.in`,
      passwordHash: pharmacistPasswordHash,
      roleId: roleMap['Pharmacist'],
      active: true,
    },
  });

  console.log(
    `  ✓ Seeded Pharmacist user: pharmacist@${TENANT_TAG}.esic.gov.in (${pharmacistUser.id})`,
  );

  const storeManagerPasswordHash = await bcrypt.hash('StoreManagerPass123!', 10);
  const storeManagerUser = await prisma.user.upsert({
    where: { identifier: `storemanager@${TENANT_TAG}.esic.gov.in` },
    update: {
      passwordHash: storeManagerPasswordHash,
      roleId: roleMap['StoreManager'],
      active: true,
    },
    create: {
      identifier: `storemanager@${TENANT_TAG}.esic.gov.in`,
      passwordHash: storeManagerPasswordHash,
      roleId: roleMap['StoreManager'],
      active: true,
    },
  });

  console.log(
    `  ✓ Seeded StoreManager user: storemanager@${TENANT_TAG}.esic.gov.in (${storeManagerUser.id})`,
  );

  const procurementPasswordHash = await bcrypt.hash('ProcurementPass123!', 10);
  const procurementUser = await prisma.user.upsert({
    where: { identifier: `procurement@${TENANT_TAG}.esic.gov.in` },
    update: {
      passwordHash: procurementPasswordHash,
      roleId: roleMap['ProcurementOfficer'],
      active: true,
    },
    create: {
      identifier: `procurement@${TENANT_TAG}.esic.gov.in`,
      passwordHash: procurementPasswordHash,
      roleId: roleMap['ProcurementOfficer'],
      active: true,
    },
  });

  console.log(
    `  ✓ Seeded ProcurementOfficer user: procurement@${TENANT_TAG}.esic.gov.in (${procurementUser.id})`,
  );

  const receptionPasswordHash = await bcrypt.hash('ReceptionPass123!', 10);
  const receptionUser = await prisma.user.upsert({
    where: { identifier: `reception@${TENANT_TAG}.esic.gov.in` },
    update: {
      passwordHash: receptionPasswordHash,
      roleId: roleMap['Reception'],
      active: true,
    },
    create: {
      identifier: `reception@${TENANT_TAG}.esic.gov.in`,
      passwordHash: receptionPasswordHash,
      roleId: roleMap['Reception'],
      active: true,
    },
  });

  console.log(
    `  ✓ Seeded Reception user: reception@${TENANT_TAG}.esic.gov.in (${receptionUser.id})`,
  );

  const dataEntryPasswordHash = await bcrypt.hash('DataEntryPass123!', 10);
  const dataEntryUser = await prisma.user.upsert({
    where: { identifier: `dataentry@${TENANT_TAG}.esic.gov.in` },
    update: {
      passwordHash: dataEntryPasswordHash,
      roleId: roleMap['DataEntryOperator'],
      active: true,
    },
    create: {
      identifier: `dataentry@${TENANT_TAG}.esic.gov.in`,
      passwordHash: dataEntryPasswordHash,
      roleId: roleMap['DataEntryOperator'],
      active: true,
    },
  });

  console.log(
    `  ✓ Seeded DataEntryOperator user: dataentry@${TENANT_TAG}.esic.gov.in (${dataEntryUser.id})`,
  );

  const queueManagerPasswordHash = await bcrypt.hash('QueueManagerPass123!', 10);
  const queueManagerUser = await prisma.user.upsert({
    where: { identifier: `queuemanager@${TENANT_TAG}.esic.gov.in` },
    update: {
      passwordHash: queueManagerPasswordHash,
      roleId: roleMap['QueueManager'],
      active: true,
    },
    create: {
      identifier: `queuemanager@${TENANT_TAG}.esic.gov.in`,
      passwordHash: queueManagerPasswordHash,
      roleId: roleMap['QueueManager'],
      active: true,
    },
  });

  console.log(
    `  ✓ Seeded QueueManager user: queuemanager@${TENANT_TAG}.esic.gov.in (${queueManagerUser.id})`,
  );

  const labTechPasswordHash = await bcrypt.hash('LabTechPass123!', 10);
  const labTechUser = await prisma.user.upsert({
    where: { identifier: `labtech@${TENANT_TAG}.esic.gov.in` },
    update: {
      passwordHash: labTechPasswordHash,
      roleId: roleMap['LabTechnician'],
      active: true,
    },
    create: {
      identifier: `labtech@${TENANT_TAG}.esic.gov.in`,
      passwordHash: labTechPasswordHash,
      roleId: roleMap['LabTechnician'],
      active: true,
    },
  });

  console.log(
    `  ✓ Seeded LabTechnician user: labtech@${TENANT_TAG}.esic.gov.in (${labTechUser.id})`,
  );

  const pathologistPasswordHash = await bcrypt.hash('PathologistPass123!', 10);
  const pathologistUser = await prisma.user.upsert({
    where: { identifier: `pathologist@${TENANT_TAG}.esic.gov.in` },
    update: {
      passwordHash: pathologistPasswordHash,
      roleId: roleMap['Pathologist'],
      active: true,
    },
    create: {
      identifier: `pathologist@${TENANT_TAG}.esic.gov.in`,
      passwordHash: pathologistPasswordHash,
      roleId: roleMap['Pathologist'],
      active: true,
    },
  });

  console.log(
    `  ✓ Seeded Pathologist user: pathologist@${TENANT_TAG}.esic.gov.in (${pathologistUser.id})`,
  );

  // 6. Seed sample Patients, Visits, and OPDVisits for General Medicine
  // 6. Seed Doctor Profiles (Replacing Fake Patients)
  const doctorsData = [
    {
      name: 'Dr. Ramesh Sharma',
      specialty: 'General Physician',
      experience: '15 Years',
      email: `r.sharma@${TENANT_TAG}.esic.gov.in`,
    },
    {
      name: 'Dr. Ankit Verma',
      specialty: 'General Physician',
      experience: '10 Years',
      email: `a.verma@${TENANT_TAG}.esic.gov.in`,
    },
    {
      name: 'Dr. Anita Desai',
      specialty: 'Cardiologist',
      experience: '12 Years',
      email: `a.desai@${TENANT_TAG}.esic.gov.in`,
    },
    {
      name: 'Dr. Sanjay Mehra',
      specialty: 'Cardiologist',
      experience: '18 Years',
      email: `s.mehra@${TENANT_TAG}.esic.gov.in`,
    },
    {
      name: 'Dr. Vikram Singh',
      specialty: 'Orthopedics',
      experience: '8 Years',
      email: `v.singh@${TENANT_TAG}.esic.gov.in`,
    },
    {
      name: 'Dr. Sunita Rao',
      specialty: 'Pediatrician',
      experience: '20 Years',
      email: `s.rao@${TENANT_TAG}.esic.gov.in`,
    },
    {
      name: 'Dr. Manish Gupta',
      specialty: 'Neurologist',
      experience: '10 Years',
      email: `m.gupta@${TENANT_TAG}.esic.gov.in`,
    },
    {
      name: 'Dr. Priya Patel',
      specialty: 'Dermatologist',
      experience: '5 Years',
      email: `p.patel@${TENANT_TAG}.esic.gov.in`,
    },
  ];

  for (const doc of doctorsData) {
    const user = await prisma.user.upsert({
      where: { identifier: doc.email },
      update: {
        passwordHash: doctorPasswordHash,
        roleId: roleMap['Doctor'],
        active: true,
      },
      create: {
        identifier: doc.email,
        passwordHash: doctorPasswordHash,
        roleId: roleMap['Doctor'],
        active: true,
      },
    });

    const empId = `DOC-${doc.email.split('@')[0]}`;
    const employee = await prisma.employee.upsert({
      where: { employeeId: empId },
      update: {},
      create: {
        employeeId: empId,
        name: doc.name,
        department: doc.specialty,
        postId: seniorOfficerPost.id,
        gradeId: grade10.id,
        employmentTypeId: permanentType.id,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { employeeId: employee.id },
    });

    await prisma.doctorProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        specialty: doc.specialty,
        experience: doc.experience,
        available: true,
      },
    });
  }

  console.log(`  ✓ Seeded 8 Doctor Profiles for Schedule`);

  // 12. Seed Medicine Master & Stock Batches
  const pcmMed = await prisma.medicine.upsert({
    where: { id: '00000000-0000-0000-0000-000000000701' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000701',
      genericName: 'Paracetamol',
      brandName: 'Crocin / Calpol',
      category: 'Analgesics & Antipyretics',
      strength: '500mg',
      dosageForm: 'Tablet',
    },
  });

  await prisma.medicineBatch.upsert({
    where: { id: '00000000-0000-0000-0000-000000000711' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000711',
      medicineId: pcmMed.id,
      batchNumber: 'PCM-2026-A1',
      manufacturer: 'Cipla India',
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2027-12-31'),
      purchasePrice: 8.5,
      issuePrice: 15.0,
      currentStock: 450,
      minimumStockLevel: 50,
      reorderLevel: 100,
      storageLocation: 'Rack A-01 (Pharmacy Store)',
      stockStatus: 'IN_STOCK',
    },
  });

  await prisma.medicineBatch.upsert({
    where: { id: '00000000-0000-0000-0000-000000000712' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000712',
      medicineId: pcmMed.id,
      batchNumber: 'PCM-2026-LOW',
      manufacturer: 'Cipla India',
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2026-10-31'),
      purchasePrice: 8.5,
      issuePrice: 15.0,
      currentStock: 25,
      minimumStockLevel: 50,
      reorderLevel: 100,
      storageLocation: 'Rack A-02 (Central Store)',
      stockStatus: 'CRITICAL_ALERT',
    },
  });

  const amxMed = await prisma.medicine.upsert({
    where: { id: '00000000-0000-0000-0000-000000000702' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000702',
      genericName: 'Amoxicillin',
      brandName: 'Mox 500',
      category: 'Antibiotics',
      strength: '500mg',
      dosageForm: 'Capsule',
    },
  });

  await prisma.medicineBatch.upsert({
    where: { id: '00000000-0000-0000-0000-000000000721' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000721',
      medicineId: amxMed.id,
      batchNumber: 'AMX-2026-B1',
      manufacturer: 'Sun Pharma',
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2027-08-31'),
      purchasePrice: 22.0,
      issuePrice: 35.0,
      currentStock: 350,
      minimumStockLevel: 50,
      reorderLevel: 100,
      storageLocation: 'Rack B-04',
      stockStatus: 'IN_STOCK',
    },
  });

  const aziMed = await prisma.medicine.upsert({
    where: { id: '00000000-0000-0000-0000-000000000703' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000703',
      genericName: 'Azithromycin',
      brandName: 'Azee 500',
      category: 'Antibiotics',
      strength: '500mg',
      dosageForm: 'Tablet',
    },
  });

  await prisma.medicineBatch.upsert({
    where: { id: '00000000-0000-0000-0000-000000000731' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000731',
      medicineId: aziMed.id,
      batchNumber: 'AZI-2026-C1',
      manufacturer: 'Torrent Pharma',
      manufacturingDate: new Date('2026-01-01'),
      expiryDate: new Date('2027-06-30'),
      purchasePrice: 42.0,
      issuePrice: 65.0,
      currentStock: 120,
      minimumStockLevel: 30,
      reorderLevel: 80,
      storageLocation: 'Rack B-12',
      stockStatus: 'IN_STOCK',
    },
  });

  console.log(
    `  ✓ Seeded Medicine Master & Stock Batches (Paracetamol, Amoxicillin, Azithromycin)`,
  );

  // 13. Seed Suppliers & Procurement Purchase Requisitions
  const supplier1 = await prisma.supplier.upsert({
    where: { id: '00000000-0000-0000-0000-000000000801' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000801',
      name: 'Cipla Healthcare Ltd',
      contactPerson: 'Ramesh Shah',
      email: 'orders@cipla.com',
      phone: '+91-9820012345',
      address: 'Industrial Estate, Mumbai, India',
    },
  });

  const req1 = await prisma.purchaseRequisition.upsert({
    where: { id: '00000000-0000-0000-0000-000000000811' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000811',
      raisedBy: storeManagerUser.id,
      status: 'APPROVED',
      triggeredByAlert: true,
      items: {
        create: [
          {
            medicineId: pcmMed.id,
            quantity: 1000,
          },
        ],
      },
      approvals: {
        create: [
          {
            approvedBy: adminUser.id,
            decision: 'APPROVED',
            notes: 'Approved for urgent central store restocking',
          },
        ],
      },
    },
  });

  await prisma.purchaseOrder.upsert({
    where: { id: '00000000-0000-0000-0000-000000000821' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000821',
      requisitionId: req1.id,
      supplierId: supplier1.id,
      issuedBy: procurementUser.id,
      status: 'ISSUED',
      items: {
        create: [
          {
            medicineId: pcmMed.id,
            quantity: 1000,
            unitPrice: 8.5,
          },
        ],
      },
    },
  });

  console.log(
    `  ✓ Seeded Procurement Master (Suppliers, Purchase Requisitions & Issued Purchase Orders)`,
  );

  // 13. Seed Service Catalogue & Pricing Master (Phase 1)
  await seedCatalog(prisma);

  // 14. Seed Laboratory Test Master (Phase 3)
  await seedLabCatalog(prisma);

  // 15. Seed default clinical departments. Moved here from
  // DepartmentService.onModuleInit() -- see that file for why.
  for (const d of SEED_DEPARTMENTS) {
    await prisma.department.upsert({ where: { code: d.code }, update: {}, create: d });
  }
  console.log(`  ✓ Seeded default clinical departments`);

  // 16. Seed default branding singleton. Moved here from
  // BrandingController.onModuleInit() -- see that file for why.
  await prisma.brandingConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...DEFAULT_BRANDING },
    update: {},
  });
  console.log(`  ✓ Seeded default branding`);

  // 17. Seed default hospital settings singleton -- same pattern as branding.
  await prisma.hospitalSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...DEFAULT_HOSPITAL_SETTINGS },
    update: {},
  });
  console.log(`  ✓ Seeded default hospital settings`);

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
