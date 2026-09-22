/**
 * One-off: removes the fixed set of demo/reference Doctor accounts
 * (Dr. Ramesh Sharma, Dr. Ankit Verma, Dr. Anita Desai, Dr. Sanjay Mehra,
 * Dr. Vikram Singh, Dr. Sunita Rao, Dr. Manish Gupta, Dr. Priya Patel) that
 * prisma/seed.ts used to create for every hospital, before it was trimmed
 * down to stop seeding demo data at all. Any hospital already onboarded
 * before that fix keeps these forever otherwise -- seed.ts only ever
 * upserts, it never deletes rows for entries no longer in the script.
 *
 * Safe by construction, not by manual checking: none of the deletes below
 * declare onDelete: Cascade in the Prisma schema, so Postgres' own
 * foreign-key constraints reject the WHOLE per-hospital transaction outright
 * the moment any of these doctors has a real OPD visit, admission, lab
 * order, prescription, receipt, or anything else attached to their User/
 * DoctorProfile/Employee rows. There is no code path here that can silently
 * destroy real clinical data -- worst case is a loud failure naming which
 * doctor has real data, and nothing else in that hospital gets touched.
 *
 * Usage:
 *   pnpm run remove:demo-doctors -- --hospital=<slug>   (one hospital)
 *   pnpm run remove:demo-doctors -- --all               (every onboarded hospital)
 */
import { PrismaClient as PlatformPrismaClient } from '.prisma/platform-client';
import { PrismaClient as TenantPrismaClient } from '@prisma/client';

const DEMO_DOCTOR_LOCAL_PARTS = ['r.sharma', 'a.verma', 'a.desai', 's.mehra', 'v.singh', 's.rao', 'm.gupta', 'p.patel'];

/** Mirrors prisma/seed.ts's TENANT_TAG derivation exactly, so the identifiers this script looks for are byte-for-byte what seed.ts actually created. */
function tenantTagFor(schemaName: string): string {
  return schemaName.replace(/^hospital_/, '').replace(/_/g, '-');
}

function tenantClient(schemaName: string) {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('schema', schemaName);
  return new TenantPrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function removeForHospital(platform: PlatformPrismaClient, schemaName: string, hospitalName: string) {
  const identifiers = DEMO_DOCTOR_LOCAL_PARTS.map((local) => `${local}@${tenantTagFor(schemaName)}.esic.gov.in`);
  const client = tenantClient(schemaName);

  try {
    const users = await client.user.findMany({
      where: { identifier: { in: identifiers } },
      include: { doctorProfile: true },
    });

    if (users.length === 0) {
      console.log(`  - ${hospitalName}: none of the demo doctor accounts exist here, nothing to do.`);
      return;
    }

    console.log(`  - ${hospitalName}: found ${users.length} demo doctor account(s): ${users.map((u) => u.identifier).join(', ')}`);

    await client.$transaction(async (tx) => {
      for (const user of users) {
        if (user.doctorProfile) {
          await tx.doctorProfile.delete({ where: { userId: user.id } });
        }
        const employeeId = user.employeeId;
        await tx.user.delete({ where: { id: user.id } });
        if (employeeId) {
          await tx.employee.delete({ where: { id: employeeId } });
        }
      }
    });

    console.log(`  - ${hospitalName}: removed ${users.length} demo doctor account(s) and their Employee/DoctorProfile rows.`);

    // Also drop them from the platform-wide login directory, or the exact
    // same identifier collides the next time anyone tries to create an
    // account (demo or real) under it.
    await platform.loginIdentifier.deleteMany({ where: { identifier: { in: users.map((u) => u.identifier) } } });
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  const platform = new PlatformPrismaClient();
  const args = process.argv.slice(2);
  const hospitalArg = args.find((a) => a.startsWith('--hospital='))?.split('=')[1];
  const all = args.includes('--all');

  if (!hospitalArg && !all) {
    console.error('Usage: pnpm run remove:demo-doctors -- --hospital=<slug>  (or --all for every hospital)');
    process.exit(1);
  }

  const hospitals = await platform.hospital.findMany({
    where: {
      status: { not: 'PROVISIONING' },
      ...(hospitalArg ? { slug: hospitalArg } : {}),
    },
  });

  if (hospitalArg && hospitals.length === 0) {
    console.error(`No onboarded hospital found with slug "${hospitalArg}".`);
    await platform.$disconnect();
    process.exit(1);
  }

  console.log(`Removing demo doctor accounts from ${hospitals.length} hospital(s)...`);
  for (const hospital of hospitals) {
    await removeForHospital(platform, hospital.schemaName, hospital.name);
  }

  await platform.$disconnect();
  console.log('\nDone.');
}

main().catch((e) => {
  console.error('\nFAILED:', e.message || e);
  process.exit(1);
});
