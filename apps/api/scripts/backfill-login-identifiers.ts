/**
 * One-off: registers every existing tenant user (across every hospital) and
 * every existing PlatformUser into the new LoginIdentifier directory, so the
 * unified login can resolve them without anyone's password or identifier
 * changing. Fails loudly on any collision instead of silently picking one --
 * a real collision must be resolved by hand before go-live.
 *
 * Usage: pnpm run backfill:login-identifiers
 */
import { PrismaClient as PlatformPrismaClient } from '.prisma/platform-client';
import { PrismaClient as TenantPrismaClient } from '@prisma/client';

function tenantClient(schemaName: string) {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('schema', schemaName);
  return new TenantPrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function main() {
  const platform = new PlatformPrismaClient();
  const seen = new Map<string, string>(); // identifier -> where it came from, for collision messages
  const rows: { identifier: string; hospitalId: string | null }[] = [];

  const hospitals = await platform.hospital.findMany({ where: { status: { not: 'PROVISIONING' } } });
  for (const hospital of hospitals) {
    const client = tenantClient(hospital.schemaName);
    const users = await client.user.findMany({ select: { identifier: true } });
    for (const u of users) {
      const existing = seen.get(u.identifier);
      if (existing) {
        throw new Error(
          `Collision: identifier "${u.identifier}" exists in both "${existing}" and "${hospital.name}". ` +
            `Resolve this by hand (rename one of them) before running the backfill again.`,
        );
      }
      seen.set(u.identifier, hospital.name);
      rows.push({ identifier: u.identifier, hospitalId: hospital.id });
    }
    await client.$disconnect();
    console.log(`  - ${hospital.name}: ${users.length} user(s) queued`);
  }

  const platformUsers = await platform.platformUser.findMany({ select: { email: true } });
  for (const pu of platformUsers) {
    const existing = seen.get(pu.email);
    if (existing) {
      throw new Error(
        `Collision: identifier "${pu.email}" exists in both "${existing}" and the platform admin accounts. ` +
          `Resolve this by hand before running the backfill again.`,
      );
    }
    seen.set(pu.email, 'platform');
    rows.push({ identifier: pu.email, hospitalId: null });
  }
  console.log(`  - Platform: ${platformUsers.length} admin(s) queued`);

  console.log(`\nRegistering ${rows.length} identifier(s)...`);
  for (const row of rows) {
    await platform.loginIdentifier.upsert({
      where: { identifier: row.identifier },
      update: { hospitalId: row.hospitalId },
      create: row,
    });
  }

  await platform.$disconnect();
  console.log(`\nBackfill complete: ${rows.length} identifier(s) registered, zero collisions.`);
}

main().catch((e) => {
  console.error('\nBACKFILL FAILED:', e.message || e);
  process.exit(1);
});
