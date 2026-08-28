import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const emp = await prisma.employee.findUnique({
    where: { employeeId: 'EMP-1001' },
    include: { hospitalUid: true }
  });
  console.log(emp);

  if (emp) {
    await prisma.employee.delete({
      where: { id: emp.id }
    });
    console.log('Deleted EMP-1001');
  } else {
    // maybe case insensitive?
    const emps = await prisma.employee.findMany({
      where: { employeeId: { equals: 'EMP-1001', mode: 'insensitive' } },
      include: { hospitalUid: true }
    });
    console.log('Case insensitive matches:', emps);
    for (const e of emps) {
      await prisma.employee.delete({ where: { id: e.id } });
      console.log('Deleted', e.employeeId);
    }
  }

  // Also check if ESIC-2026-000001 exists and is attached to someone else
  const uid = await prisma.hospitalUID.findUnique({
    where: { uidCode: 'ESIC-2026-000001' }
  });
  console.log('UID:', uid);
  if (uid) {
    await prisma.hospitalUID.delete({
      where: { id: uid.id }
    });
    console.log('Deleted HospitalUID ESIC-2026-000001');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
