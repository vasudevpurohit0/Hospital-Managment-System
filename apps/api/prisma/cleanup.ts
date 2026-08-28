import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning up stale data...');
  await prisma.oPDVisit.deleteMany();
  await prisma.diagnosis.deleteMany();
  await prisma.prescriptionItem.deleteMany();
  await prisma.prescription.deleteMany();
  await prisma.admissionNote.deleteMany();
  await prisma.admission.deleteMany();
  await prisma.visit.deleteMany();
  await prisma.patientProfile.deleteMany();
  await prisma.hospitalUID.deleteMany();
  
  // Clean fake test employees (EMP-1001, EMP-1002, EMP-1003)
  await prisma.employee.deleteMany({
    where: {
      employeeId: {
        in: ['EMP-1001', 'EMP-1002', 'EMP-1003']
      }
    }
  });

  // Clean procurement data
  await prisma.gRNItem.deleteMany();
  await prisma.goodsReceiptNote.deleteMany();
  await prisma.pOItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.requisitionItem.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.purchaseRequisition.deleteMany();

  console.log('Cleanup complete.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
