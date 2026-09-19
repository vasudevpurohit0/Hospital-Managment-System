import { PrismaClient } from '@prisma/client';
import { assertSafeToRunDestructiveScript } from './guard-destructive-script';

assertSafeToRunDestructiveScript('delete-fake-emps.ts');

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
