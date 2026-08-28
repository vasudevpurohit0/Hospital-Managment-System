import { PrismaClient, EmploymentTypeCode, VisitType, VisitStatus, POStatus, RequisitionStatus, StockStatus, PharmacyLocation } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Injecting connected demo data for presentation...');

  const doctor = await prisma.user.findUnique({
    where: { identifier: 'r.sharma@esic.gov.in' },
    include: { employee: true }
  });

  if (!doctor || !doctor.employee) {
    console.error('Doctor not found. Please run regular seed first.');
    return;
  }

  const dept = await prisma.department.findFirst() || await prisma.department.create({ data: { name: 'General Medicine', code: 'GENMED' } });
  const post = await prisma.post.findFirst();
  const grade = await prisma.grade.findFirst();
  const empType = await prisma.employmentType.findFirst();
  
  if (!post || !grade || !empType) {
    console.error('Master data (Post/Grade/EmpType) missing.');
    return;
  }

  const patientsData = [
    { id: 'DEMO-P1', name: 'Ravi Kumar', uid: 'ESIC-DEMO-001' },
    { id: 'DEMO-P2', name: 'Priya Sharma', uid: 'ESIC-DEMO-002' }
  ];

  const createdPatients = [];
  for (const p of patientsData) {
    const emp = await prisma.employee.upsert({
      where: { employeeId: p.id },
      update: {},
      create: {
        employeeId: p.id,
        name: p.name,
        department: 'Engineering',
        postId: post.id,
        gradeId: grade.id,
        employmentTypeId: empType.id,
        contactPhone: '9876543210',
      }
    });

    await prisma.patientProfile.upsert({
      where: { employeeId: emp.id },
      update: {},
      create: {
        employeeId: emp.id,
        eligibilityCategory: 'C',
        gender: 'Male',
        dob: new Date('1990-05-15'),
      }
    });

    const uid = await prisma.hospitalUID.upsert({
      where: { uidCode: p.uid },
      update: {},
      create: {
        uidCode: p.uid,
        employeeId: emp.id,
        qrPayload: `qr-data-${p.uid}`
      }
    });
    
    createdPatients.push(emp);
    console.log(`  ✓ Created patient: ${p.name} (${p.uid})`);
  }

  const medicine = await prisma.medicine.findFirst();
  if (!medicine) {
    console.error('No medicine found to prescribe.');
    return;
  }

  let i = 1;
  for (const emp of createdPatients) {
    const visit = await prisma.visit.create({
      data: {
        employeeId: emp.id,
        type: VisitType.OPD,
        status: VisitStatus.OPEN,
      }
    });

    await prisma.oPDVisit.create({
      data: {
        visitId: visit.id,
        departmentId: dept.id,
        tokenNumber: `GENMED-${100 + i}`,
      }
    });

    await prisma.diagnosis.create({
      data: {
        visitId: visit.id,
        doctorId: doctor.id,
        diagnosisText: 'Acute nasopharyngitis (common cold)',
        examinationNotes: 'Patient has mild fever and runny nose.',
      }
    });

    const prescription = await prisma.prescription.create({
      data: {
        visitId: visit.id,
        doctorId: doctor.id,
      }
    });

    await prisma.prescriptionItem.create({
      data: {
        prescriptionId: prescription.id,
        medicineName: medicine.genericName,
        dose: '500mg',
        frequency: '1-1-1',
        duration: '3 days',
        dispensedQuantity: 0,
      }
    });
    
    console.log(`  ✓ Created visit & prescription for ${emp.name}`);
    i++;
  }

  let batch = await prisma.medicineBatch.findFirst({ where: { medicineId: medicine.id } });
  if (!batch) {
    batch = await prisma.medicineBatch.create({
      data: {
        medicineId: medicine.id,
        batchNumber: 'DEMO-BATCH-001',
        manufacturer: 'Demo Pharma',
        manufacturingDate: new Date(),
        expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 2)),
        purchasePrice: 10,
        issuePrice: 15,
        currentStock: 1000,
        minimumStockLevel: 100,
        reorderLevel: 200,
        maximumStockLevel: 2000,
        stockStatus: StockStatus.IN_STOCK,
      }
    });
  }

  const pharmStock = await prisma.pharmacyStock.findFirst({
    where: { medicineBatchId: batch.id, location: PharmacyLocation.PHARMACY }
  });

  if (pharmStock) {
    await prisma.pharmacyStock.update({
      where: { id: pharmStock.id },
      data: { quantity: 500 }
    });
  } else {
    await prisma.pharmacyStock.create({
      data: {
        medicineBatchId: batch.id,
        location: PharmacyLocation.PHARMACY,
        quantity: 500
      }
    });
  }
  
  console.log(`  ✓ Added 500 units of ${medicine.genericName} to Pharmacy Stock`);

  const supplier = await prisma.supplier.findFirst() || await prisma.supplier.create({
    data: { name: 'HealthCare Distributors Ltd', contactPerson: 'Mr. Gupta' }
  });

  const requisition = await prisma.purchaseRequisition.create({
    data: {
      raisedBy: doctor.id,
      status: RequisitionStatus.APPROVED,
      triggeredByAlert: true,
      triggerReason: 'Low stock in central store',
      items: {
        create: [
          { medicineId: medicine.id, quantity: 1000 }
        ]
      },
      approvals: {
        create: [
          {
            approvedBy: doctor.id,
            decision: 'APPROVED',
            notes: 'Approved for demo',
          }
        ]
      }
    }
  });

  const po = await prisma.purchaseOrder.create({
    data: {
      requisitionId: requisition.id,
      supplierId: supplier.id,
      issuedBy: doctor.id,
      status: POStatus.ISSUED,
      items: {
        create: [
          { medicineId: medicine.id, quantity: 1000, unitPrice: 10.50 }
        ]
      }
    }
  });

  console.log(`  ✓ Created Procurement Requisition (Req# ${requisition.id.split('-')[0]}) and PO (PO# ${po.id.split('-')[0]})`);

  console.log('✅ Demo data injection complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
