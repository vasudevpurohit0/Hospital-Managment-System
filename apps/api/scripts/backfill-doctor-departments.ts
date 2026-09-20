/**
 * One-off: assigns a Department to every DoctorProfile that has none, so the
 * doctor becomes selectable in the OPD registration "Assigned Doctor" picker.
 *
 * Why this exists: doctors carry a free-text `specialty` string
 * ("Cardiologist") that is separate from the relational `departmentId`
 * (Cardiology). OPD registration eligibility filters by `departmentId`
 * only, so a doctor with a null department never appears there no matter
 * how their schedule is set. Seeded doctors historically had no department,
 * making every registration department show "No doctors available".
 *
 * The mapping below covers the known seed specialties. Any specialty that
 * doesn't map to an existing department (e.g. "Neurologist" when there is no
 * Neurology department) is reported and left untouched -- assign it by hand
 * from Doctor Schedule -> Edit -> Department once such a department exists.
 *
 * Safe to re-run: only rows whose departmentId is currently null are touched,
 * so deliberate manual assignments are never overwritten.
 *
 * Usage: pnpm run backfill:doctor-departments
 */
import { PrismaClient as PlatformPrismaClient } from '.prisma/platform-client';
import { PrismaClient as TenantPrismaClient } from '@prisma/client';

// Specialty (free text) -> Department code (SEED_DEPARTMENTS). Compared
// case-insensitively after trimming. Extend this as new specialties/
// departments are introduced.
const SPECIALTY_TO_DEPT_CODE: Record<string, string> = {
  'general physician': 'GENMED',
  'general medicine': 'GENMED',
  cardiologist: 'CARDIO',
  cardiology: 'CARDIO',
  orthopedics: 'ORTHO',
  orthopedic: 'ORTHO',
  orthopaedics: 'ORTHO',
  pediatrician: 'PEDIATRIC',
  pediatrics: 'PEDIATRIC',
  paediatrician: 'PEDIATRIC',
  dermatologist: 'DERMA',
  dermatology: 'DERMA',
  ent: 'ENT',
  otolaryngologist: 'ENT',
};

function tenantClient(schemaName: string) {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('schema', schemaName);
  return new TenantPrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function backfillSchema(schemaName: string, label: string): Promise<void> {
  const client = tenantClient(schemaName);
  try {
    const departments = await client.department.findMany({ select: { id: true, code: true } });
    const idByCode = new Map(departments.map((d) => [d.code.toUpperCase(), d.id]));

    const orphans = await client.doctorProfile.findMany({
      where: { departmentId: null },
      select: { id: true, specialty: true, user: { select: { identifier: true } } },
    });

    if (orphans.length === 0) {
      console.log(`  - ${label}: no doctors missing a department`);
      return;
    }

    let assigned = 0;
    const unmapped: string[] = [];
    for (const doc of orphans) {
      const code = SPECIALTY_TO_DEPT_CODE[doc.specialty.trim().toLowerCase()];
      const deptId = code ? idByCode.get(code.toUpperCase()) : undefined;
      if (!deptId) {
        unmapped.push(`${doc.user?.identifier ?? doc.id} (specialty: "${doc.specialty}")`);
        continue;
      }
      await client.doctorProfile.update({ where: { id: doc.id }, data: { departmentId: deptId } });
      assigned += 1;
    }

    console.log(`  - ${label}: ${assigned} doctor(s) assigned a department`);
    if (unmapped.length > 0) {
      console.log(
        `      ${unmapped.length} left unassigned (no matching department -- assign by hand):\n` +
          unmapped.map((u) => `        · ${u}`).join('\n'),
      );
    }
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  const platform = new PlatformPrismaClient();
  try {
    const hospitals = await platform.hospital.findMany({
      where: { status: { not: 'PROVISIONING' } },
      select: { name: true, schemaName: true },
    });

    if (hospitals.length === 0) {
      // No platform hospitals registered yet (fresh single-tenant dev DB):
      // fall back to whatever schema DATABASE_URL points at (default public).
      const schema = new URL(process.env.DATABASE_URL!).searchParams.get('schema') || 'public';
      await backfillSchema(schema, `schema "${schema}"`);
    } else {
      for (const h of hospitals) {
        await backfillSchema(h.schemaName, h.name);
      }
    }
  } finally {
    await platform.$disconnect();
  }
  console.log('\nDoctor-department backfill complete.');
}

main().catch((e) => {
  console.error('\nBACKFILL FAILED:', e?.message || e);
  process.exit(1);
});
