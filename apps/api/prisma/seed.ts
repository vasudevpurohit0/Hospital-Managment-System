import { PrismaClient, EmploymentTypeCode, FacilityCategory, RoomType, BedStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

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
  'SuperAdmin',
] as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[number];

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
  const permissionsData: { roleName: SystemRoleName; resource: string; action: string }[] = [
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

    // --- Doctor ---
    { roleName: 'Doctor', resource: 'Employee', action: 'read' },
    { roleName: 'Doctor', resource: 'Visit', action: 'read' },
    { roleName: 'Doctor', resource: 'OPDVisit', action: 'read' },
    { roleName: 'Doctor', resource: 'Diagnosis', action: 'create' },
    { roleName: 'Doctor', resource: 'Diagnosis', action: 'read' },
    { roleName: 'Doctor', resource: 'Prescription', action: 'create' },
    { roleName: 'Doctor', resource: 'Prescription', action: 'read' },
    { roleName: 'Doctor', resource: 'Prescription', action: 'sign' },
    { roleName: 'Doctor', resource: 'Admission', action: 'create' }, // Recommendation stub
    { roleName: 'Doctor', resource: 'Admission', action: 'read' },
    { roleName: 'Doctor', resource: 'Admission', action: 'approve' }, // Discharge approval

    // --- AdmissionDesk ---
    { roleName: 'AdmissionDesk', resource: 'Employee', action: 'read' },
    { roleName: 'AdmissionDesk', resource: 'Visit', action: 'read' },
    { roleName: 'AdmissionDesk', resource: 'Admission', action: 'create' },
    { roleName: 'AdmissionDesk', resource: 'Admission', action: 'read' },
    { roleName: 'AdmissionDesk', resource: 'Admission', action: 'update' },

    // --- Nurse ---
    { roleName: 'Nurse', resource: 'Employee', action: 'read' },
    { roleName: 'Nurse', resource: 'Visit', action: 'read' },
    { roleName: 'Nurse', resource: 'Admission', action: 'read' },
    { roleName: 'Nurse', resource: 'AdmissionNote', action: 'create' },
    { roleName: 'Nurse', resource: 'AdmissionNote', action: 'read' },

    // --- Pharmacist ---
    { roleName: 'Pharmacist', resource: 'Employee', action: 'read' },
    { roleName: 'Pharmacist', resource: 'Prescription', action: 'read' },
    { roleName: 'Pharmacist', resource: 'StockTransaction', action: 'dispense' },
    { roleName: 'Pharmacist', resource: 'StockTransaction', action: 'read' },
    { roleName: 'Pharmacist', resource: 'MedicineBatch', action: 'read' },

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

    // --- ProcurementOfficer ---
    { roleName: 'ProcurementOfficer', resource: 'PurchaseRequisition', action: 'read' },
    { roleName: 'ProcurementOfficer', resource: 'Approval', action: 'approve' },
    { roleName: 'ProcurementOfficer', resource: 'PurchaseOrder', action: 'create' },
    { roleName: 'ProcurementOfficer', resource: 'PurchaseOrder', action: 'read' },

    // --- Administrator (hospital-wide operational & administrative privileges) ---
    { roleName: 'Administrator', resource: 'Employee', action: 'create' },
    { roleName: 'Administrator', resource: 'Employee', action: 'read' },
    { roleName: 'Administrator', resource: 'Employee', action: 'update' },
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
    { roleName: 'Administrator', resource: 'Visit', action: 'create' },
    { roleName: 'Administrator', resource: 'Visit', action: 'read' },
    { roleName: 'Administrator', resource: 'Visit', action: 'update' },
    { roleName: 'Administrator', resource: 'OPDVisit', action: 'create' },
    { roleName: 'Administrator', resource: 'OPDVisit', action: 'read' },
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

    // --- SuperAdmin (Wildcard / all permissions) ---
    { roleName: 'SuperAdmin', resource: '*', action: '*' },
  ];

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
  console.log(`  ✓ Seeded permissions for all 10 roles`);

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
  const superAdminPasswordHash = await bcrypt.hash('SuperAdminSecret123!', 10);

  const superAdminUser = await prisma.user.upsert({
    where: { identifier: 'superadmin@esic.gov.in' },
    update: {
      passwordHash: superAdminPasswordHash,
      roleId: roleMap['SuperAdmin'],
      active: true,
    },
    create: {
      identifier: 'superadmin@esic.gov.in',
      passwordHash: superAdminPasswordHash,
      roleId: roleMap['SuperAdmin'],
      active: true,
    },
  });

  console.log(`  ✓ Seeded SuperAdmin user: superadmin@esic.gov.in (${superAdminUser.id})`);

  const doctorPasswordHash = await bcrypt.hash('DoctorPass123!', 10);
  const doctorUser = await prisma.user.upsert({
    where: { identifier: 'doctor@esic.gov.in' },
    update: {
      passwordHash: doctorPasswordHash,
      roleId: roleMap['Doctor'],
      active: true,
    },
    create: {
      identifier: 'doctor@esic.gov.in',
      passwordHash: doctorPasswordHash,
      roleId: roleMap['Doctor'],
      active: true,
    },
  });

  console.log(`  ✓ Seeded Doctor user: doctor@esic.gov.in (${doctorUser.id})`);

  const nursePasswordHash = await bcrypt.hash('NursePass123!', 10);
  const nurseUser = await prisma.user.upsert({
    where: { identifier: 'nurse@esic.gov.in' },
    update: {
      passwordHash: nursePasswordHash,
      roleId: roleMap['Nurse'],
      active: true,
    },
    create: {
      identifier: 'nurse@esic.gov.in',
      passwordHash: nursePasswordHash,
      roleId: roleMap['Nurse'],
      active: true,
    },
  });

  console.log(`  ✓ Seeded Nurse user: nurse@esic.gov.in (${nurseUser.id})`);

  const admissionPasswordHash = await bcrypt.hash('AdmissionPass123!', 10);
  const admissionUser = await prisma.user.upsert({
    where: { identifier: 'admission@esic.gov.in' },
    update: {
      passwordHash: admissionPasswordHash,
      roleId: roleMap['AdmissionDesk'],
      active: true,
    },
    create: {
      identifier: 'admission@esic.gov.in',
      passwordHash: admissionPasswordHash,
      roleId: roleMap['AdmissionDesk'],
      active: true,
    },
  });

  console.log(`  ✓ Seeded AdmissionDesk user: admission@esic.gov.in (${admissionUser.id})`);

  const adminPasswordHash = await bcrypt.hash('AdminPass123!', 10);
  const adminUser = await prisma.user.upsert({
    where: { identifier: 'admin@esic.gov.in' },
    update: {
      passwordHash: adminPasswordHash,
      roleId: roleMap['Administrator'],
      active: true,
    },
    create: {
      identifier: 'admin@esic.gov.in',
      passwordHash: adminPasswordHash,
      roleId: roleMap['Administrator'],
      active: true,
    },
  });

  console.log(`  ✓ Seeded Administrator user: admin@esic.gov.in (${adminUser.id})`);

  const pharmacistPasswordHash = await bcrypt.hash('PharmacistPass123!', 10);
  const pharmacistUser = await prisma.user.upsert({
    where: { identifier: 'pharmacist@esic.gov.in' },
    update: {
      passwordHash: pharmacistPasswordHash,
      roleId: roleMap['Pharmacist'],
      active: true,
    },
    create: {
      identifier: 'pharmacist@esic.gov.in',
      passwordHash: pharmacistPasswordHash,
      roleId: roleMap['Pharmacist'],
      active: true,
    },
  });

  console.log(`  ✓ Seeded Pharmacist user: pharmacist@esic.gov.in (${pharmacistUser.id})`);

  const storeManagerPasswordHash = await bcrypt.hash('StoreManagerPass123!', 10);
  const storeManagerUser = await prisma.user.upsert({
    where: { identifier: 'storemanager@esic.gov.in' },
    update: {
      passwordHash: storeManagerPasswordHash,
      roleId: roleMap['StoreManager'],
      active: true,
    },
    create: {
      identifier: 'storemanager@esic.gov.in',
      passwordHash: storeManagerPasswordHash,
      roleId: roleMap['StoreManager'],
      active: true,
    },
  });

  console.log(`  ✓ Seeded StoreManager user: storemanager@esic.gov.in (${storeManagerUser.id})`);

  const procurementPasswordHash = await bcrypt.hash('ProcurementPass123!', 10);
  const procurementUser = await prisma.user.upsert({
    where: { identifier: 'procurement@esic.gov.in' },
    update: {
      passwordHash: procurementPasswordHash,
      roleId: roleMap['ProcurementOfficer'],
      active: true,
    },
    create: {
      identifier: 'procurement@esic.gov.in',
      passwordHash: procurementPasswordHash,
      roleId: roleMap['ProcurementOfficer'],
      active: true,
    },
  });

  console.log(
    `  ✓ Seeded ProcurementOfficer user: procurement@esic.gov.in (${procurementUser.id})`,
  );

  const receptionPasswordHash = await bcrypt.hash('ReceptionPass123!', 10);
  const receptionUser = await prisma.user.upsert({
    where: { identifier: 'reception@esic.gov.in' },
    update: {
      passwordHash: receptionPasswordHash,
      roleId: roleMap['Reception'],
      active: true,
    },
    create: {
      identifier: 'reception@esic.gov.in',
      passwordHash: receptionPasswordHash,
      roleId: roleMap['Reception'],
      active: true,
    },
  });

  console.log(`  ✓ Seeded Reception user: reception@esic.gov.in (${receptionUser.id})`);

  const dataEntryPasswordHash = await bcrypt.hash('DataEntryPass123!', 10);
  const dataEntryUser = await prisma.user.upsert({
    where: { identifier: 'dataentry@esic.gov.in' },
    update: {
      passwordHash: dataEntryPasswordHash,
      roleId: roleMap['DataEntryOperator'],
      active: true,
    },
    create: {
      identifier: 'dataentry@esic.gov.in',
      passwordHash: dataEntryPasswordHash,
      roleId: roleMap['DataEntryOperator'],
      active: true,
    },
  });

  console.log(`  ✓ Seeded DataEntryOperator user: dataentry@esic.gov.in (${dataEntryUser.id})`);

  // 6. Seed sample Patients, Visits, and OPDVisits for General Medicine
  const genMedDept = await prisma.department.findUnique({ where: { code: 'GENMED' } });
  if (genMedDept) {
    const samplePatients = [
      {
        id: '00000000-0000-0000-0000-000000000501',
        empId: 'EMP-1001',
        name: 'Suresh Patel',
        visitId: '00000000-0000-0000-0000-000000000601',
        opdId: '00000000-0000-0000-0000-000000000701',
        token: 'GENMED-001',
        calledAt: new Date(Date.now() - 300000),
      },
      {
        id: '00000000-0000-0000-0000-000000000502',
        empId: 'EMP-1002',
        name: 'Priya Devi',
        visitId: '00000000-0000-0000-0000-000000000602',
        opdId: '00000000-0000-0000-0000-000000000702',
        token: 'GENMED-002',
        calledAt: null,
      },
      {
        id: '00000000-0000-0000-0000-000000000503',
        empId: 'EMP-1003',
        name: 'Rahul Kumar',
        visitId: '00000000-0000-0000-0000-000000000603',
        opdId: '00000000-0000-0000-0000-000000000703',
        token: 'GENMED-003',
        calledAt: null,
      },
    ];

    for (const p of samplePatients) {
      const emp = await prisma.employee.upsert({
        where: { employeeId: p.empId },
        update: {},
        create: {
          id: p.id,
          employeeId: p.empId,
          name: p.name,
          department: 'General Dept',
          postId: clerkPost.id,
          gradeId: grade4.id,
          employmentTypeId: permanentType.id,
        },
      });

      await prisma.patientProfile.upsert({
        where: { employeeId: emp.id },
        update: {},
        create: {
          employeeId: emp.id,
          eligibilityCategory: 'C',
        },
      });

      const uidCode = `ESIC-2026-${p.empId.replace(/[^0-9]/g, '').padStart(6, '0')}`;
      await prisma.hospitalUID.upsert({
        where: { employeeId: emp.id },
        update: {},
        create: {
          employeeId: emp.id,
          uidCode,
          qrPayload: uidCode,
        },
      });

      const visit = await prisma.visit.upsert({
        where: { id: p.visitId },
        update: {},
        create: {
          id: p.visitId,
          employeeId: emp.id,
          type: 'OPD',
          status: 'OPEN',
        },
      });

      await prisma.oPDVisit.upsert({
        where: { id: p.opdId },
        update: {},
        create: {
          id: p.opdId,
          visitId: visit.id,
          departmentId: genMedDept.id,
          tokenNumber: p.token,
          calledAt: p.calledAt,
        },
      });
    }
    console.log(`  ✓ Seeded sample Patients, Hospital UIDs & OPD Visits for General Medicine`);
  }

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

  console.log(`  ✓ Seeded Medicine Master & Stock Batches (Paracetamol, Amoxicillin, Azithromycin)`);

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

  console.log(`  ✓ Seeded Procurement Master (Suppliers, Purchase Requisitions & Issued Purchase Orders)`);

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
