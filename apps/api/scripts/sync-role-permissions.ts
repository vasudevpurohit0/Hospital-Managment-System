/**
 * Idempotently re-applies the canonical RBAC grants (PERMISSION_GRANTS in
 * prisma/seed.ts) to every existing tenant schema, healing "permission
 * drift": a database seeded before a grant was added to the source keeps the
 * old, incomplete grant set forever, because a full re-seed is disruptive
 * and nothing else back-fills it. That is exactly how the Doctor role ended
 * up able to READ the OPD queue but not CALL/UPDATE/TRANSFER from it, or use
 * its own duty status (check-in/break/check-out).
 *
 * New hospitals are unaffected -- onboarding runs the full seed, which
 * already applies the current grants. This script is for existing databases.
 *
 * Behaviour:
 *   - ADDITIVE ONLY. Missing (roleName, resource, action) grants are created;
 *     nothing is ever deleted, so any deliberately customised grant survives.
 *   - Safe to re-run. A schema already in sync reports "0 added".
 *   - Skips grants whose role does not exist in a given schema (logged).
 *
 * Usage: pnpm run sync:role-permissions
 */
import { PrismaClient as PlatformPrismaClient } from '.prisma/platform-client';
import { PrismaClient as TenantPrismaClient } from '@prisma/client';
import { PERMISSION_GRANTS } from '../prisma/seed';

function tenantClient(schemaName: string) {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('schema', schemaName);
  return new TenantPrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function syncSchema(schemaName: string, label: string): Promise<void> {
  const client = tenantClient(schemaName);
  try {
    // First ensure every role referenced by a grant actually exists in this
    // schema. A database seeded before a role was introduced (e.g. Accountant,
    // OPDDisplayOperator) would otherwise silently drop all of that role's
    // grants. Roles are created, never deleted.
    const grantRoleNames = Array.from(new Set(PERMISSION_GRANTS.map((g) => g.roleName)));
    const rolesCreated: string[] = [];
    for (const name of grantRoleNames) {
      const existing = await client.role.findUnique({ where: { name }, select: { id: true } });
      if (!existing) {
        await client.role.create({ data: { name, isSystemRole: true } });
        rolesCreated.push(name);
      }
    }

    const roles = await client.role.findMany({ select: { id: true, name: true } });
    const roleIdByName = new Map(roles.map((r) => [r.name, r.id]));

    let added = 0;
    const missingRoles = new Set<string>();
    const addedDetail: string[] = [];

    if (rolesCreated.length > 0) {
      console.log(`  - ${label}: created missing role(s): ${rolesCreated.join(', ')}`);
    }

    for (const grant of PERMISSION_GRANTS) {
      const roleId = roleIdByName.get(grant.roleName);
      if (!roleId) {
        missingRoles.add(grant.roleName);
        continue;
      }
      const existing = await client.permission.findUnique({
        where: { roleId_resource_action: { roleId, resource: grant.resource, action: grant.action } },
        select: { id: true },
      });
      if (existing) continue;

      await client.permission.create({ data: { roleId, resource: grant.resource, action: grant.action } });
      added += 1;
      addedDetail.push(`${grant.roleName}:${grant.resource}:${grant.action}`);
    }

    if (added === 0) {
      console.log(`  - ${label}: already in sync (0 added)`);
    } else {
      console.log(`  - ${label}: ${added} grant(s) added`);
      for (const d of addedDetail) console.log(`        + ${d}`);
    }
    if (missingRoles.size > 0) {
      console.log(`      (roles not present in this schema, skipped: ${[...missingRoles].join(', ')})`);
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
      const schema = new URL(process.env.DATABASE_URL!).searchParams.get('schema') || 'public';
      await syncSchema(schema, `schema "${schema}"`);
    } else {
      for (const h of hospitals) {
        await syncSchema(h.schemaName, h.name);
      }
    }
  } finally {
    await platform.$disconnect();
  }
  console.log('\nRole-permission sync complete.');
}

main().catch((e) => {
  console.error('\nSYNC FAILED:', e?.message || e);
  process.exit(1);
});
