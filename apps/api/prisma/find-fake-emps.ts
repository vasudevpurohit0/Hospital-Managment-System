import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const emps = await prisma.employee.findMany({
    where: {
      employeeId: {
        startsWith: 'Emp', mode: 'insensitive'
      }
    }
  });

  console.log(emps.map(e => `${e.employeeId}: ${e.name}`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
