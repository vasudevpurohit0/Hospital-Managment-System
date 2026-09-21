/**
 * One-time (repeatable) resync: brings every already-provisioned hospital's
 * Role → Permission grants up to date with the CURRENT `PERMISSION_GRANTS`
 * in `prisma/seed.ts`.
 *
 * Why this is needed: `prisma/seed.ts` only ever runs once, at hospital
 * onboarding time. When a later code change adds a new grant to
 * `PERMISSION_GRANTS` (e.g. giving Doctor `AdmissionNote:create`, or
 * Administrator `TherapySession:update`), every hospital onboarded BEFORE
 * that change keeps its original, now-stale permission set forever — there
 * is no migration path that walks existing tenants and adds the new grant.
 * Discovered live (not in any test, since a freshly-seeded test schema can
 * never be stale by definition): a real hospital's live Doctor/Administrator
 * roles were missing several grants that current `seed.ts` defines, meaning
 * the app's own frontend correctly offers an action (e.g. "mark therapy
 * session performed" for Administrator) that the backend then 403s on, for
 * that specific hospital only.
 *
 * Purely additive and non-destructive, same principle as
 * `backfill-billing-transactions.ts`:
 *  - Only ever INSERTS a (roleId, resource, action) row that is missing.
 *  - Never deletes or modifies an existing Permission row, including any
 *    custom grant an administrator added by hand via the RBAC Admin screen
 *    (`POST /api/rbac/permissions`) that isn't in `PERMISSION_GRANTS` at all
 *    — those are left completely untouched.
 *  - Idempotent: running it again with nothing new to add reports 0 added.
 *
 * Run with (per hospital schema):
 *   npx ts-node -r tsconfig-paths/register prisma/seeds/resync-role-permissions.ts --schema=hospital_apollo_indore
 *   npx ts-node -r tsconfig-paths/register prisma/seeds/resync-role-permissions.ts --all   (reads every ACTIVE hospital from the platform DB)
 * Add --dry-run to report what would be added without writing anything.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaClient as PlatformPrismaClient } from '.prisma/platform-client';
import { PERMISSION_GRANTS } from '../seed';

interface ResyncResult {
  schemaName: string;
  added: { role: string; resource: string; action: string }[];
  missingRoles: string[];
}

async function resyncSchema(schemaName: string, dryRun: boolean): Promise<ResyncResult> {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('DATABASE_URL is not set');
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schemaName);
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });

  const result: ResyncResult = { schemaName, added: [], missingRoles: [] };

  try {
    const roles = await client.role.findMany({ select: { id: true, name: true } });
    const roleIdByName = new Map(roles.map((r) => [r.name, r.id]));

    const existing = await client.permission.findMany({ select: { roleId: true, resource: true, action: true } });
    const existingKey = new Set(existing.map((p) => `${p.roleId}|${p.resource}|${p.action}`));

    const toInsert: { roleId: string; resource: string; action: string }[] = [];
    for (const grant of PERMISSION_GRANTS) {
      const roleId = roleIdByName.get(grant.roleName);
      if (!roleId) {
        if (!result.missingRoles.includes(grant.roleName)) result.missingRoles.push(grant.roleName);
        continue; // Role itself isn't seeded in this tenant (e.g. a role added after onboarding) -- out of scope for a permissions-only resync.
      }
      const key = `${roleId}|${grant.resource}|${grant.action}`;
      if (!existingKey.has(key)) {
        toInsert.push({ roleId, resource: grant.resource, action: grant.action });
        result.added.push({ role: grant.roleName, resource: grant.resource, action: grant.action });
      }
    }

    if (!dryRun && toInsert.length > 0) {
      // @@unique([roleId, resource, action]) makes this both atomic and
      // safe to re-run: a concurrent insert of the same row is silently
      // skipped, never duplicated or errored.
      await client.permission.createMany({ data: toInsert, skipDuplicates: true });
    }
  } finally {
    await client.$disconnect();
  }

  return result;
}

async function resolveTargetSchemas(all: boolean, explicitSchema?: string): Promise<string[]> {
  if (explicitSchema) return [explicitSchema];
  if (!all) return [];

  const platformUrl = process.env.PLATFORM_DATABASE_URL;
  if (!platformUrl) throw new Error('--all requires PLATFORM_DATABASE_URL to be set');
  const platform = new PlatformPrismaClient({ datasources: { db: { url: platformUrl } } });
  try {
    const hospitals = await platform.hospital.findMany({
      where: { status: 'ACTIVE' },
      select: { schemaName: true, name: true },
    });
    return hospitals.map((h: { schemaName: string }) => h.schemaName);
  } finally {
    await platform.$disconnect();
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const all = process.argv.includes('--all');
  const schemaArg = process.argv.find((a) => a.startsWith('--schema='));
  const explicitSchema = schemaArg?.split('=')[1];

  const schemas = await resolveTargetSchemas(all, explicitSchema);
  if (schemas.length === 0) {
    console.error('Usage: resync-role-permissions.ts (--schema=<name> | --all) [--dry-run]');
    process.exitCode = 1;
    return;
  }

  console.log(`🔄 Resyncing role permissions against current PERMISSION_GRANTS ${dryRun ? '(DRY RUN)' : ''}`);
  console.log(`   Target schema(s): ${schemas.join(', ')}`);

  let totalAdded = 0;
  for (const schemaName of schemas) {
    const result = await resyncSchema(schemaName, dryRun);
    console.log('');
    console.log(`── ${schemaName} ──`);
    if (result.missingRoles.length) {
      console.log(`  ⓘ Roles not seeded in this tenant (skipped): ${result.missingRoles.join(', ')}`);
    }
    if (result.added.length === 0) {
      console.log('  ✅ Already fully in sync -- nothing to add.');
    } else {
      console.log(`  ${dryRun ? 'Would add' : 'Added'} ${result.added.length} grant(s):`);
      for (const g of result.added) console.log(`    + ${g.role}: ${g.resource}:${g.action}`);
    }
    totalAdded += result.added.length;
  }

  console.log('');
  console.log(`Total grants ${dryRun ? 'that would be added' : 'added'}: ${totalAdded}`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error('❌ Resync error:', e);
      process.exitCode = 1;
    });
}

export { resyncSchema };
