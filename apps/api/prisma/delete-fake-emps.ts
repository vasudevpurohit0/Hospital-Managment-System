import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.employee.deleteMany({
    where: {
      name: {
        startsWith: 'Beneficiary',
        mode: 'insensitive'
      }
    }
  });

  console.log(`Deleted ${result.count} fake beneficiary records.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
