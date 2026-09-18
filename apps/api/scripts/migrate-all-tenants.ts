/**
 * Fans out `prisma migrate deploy` across every non-PROVISIONING hospital's
 * tenant schema. Run this as a deploy-pipeline step whenever a new migration
 * is added to prisma/migrations/, after `prisma generate` but before traffic
 * is fully cut over to the new code (new columns/tables must be
 * nullable/defaulted so old-and-new code can coexist during this window,
 * across however many tenants exist).
 *
 * Usage: pnpm run migrate:all-tenants
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { PrismaClient as PlatformPrismaClient } from '.prisma/platform-client';

const execFileAsync = promisify(execFile);
const API_ROOT = path.resolve(__dirname, '..');
const PRISMA_CLI_ENTRYPOINT = require.resolve('prisma/build/index.js');

function schemaQualifiedDatabaseUrl(schemaName: string): string {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('DATABASE_URL is not set');
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schemaName);
  return url.toString();
}

async function main() {
  const platform = new PlatformPrismaClient();
  const hospitals = await platform.hospital.findMany({ where: { status: { not: 'PROVISIONING' } } });

  console.log(`Migrating ${hospitals.length} tenant schema(s)...`);
  let failures = 0;

  for (const hospital of hospitals) {
    process.stdout.write(`  - ${hospital.slug} (${hospital.schemaName})... `);
    try {
      await execFileAsync(process.execPath, [PRISMA_CLI_ENTRYPOINT, 'migrate', 'deploy', '--schema=prisma/schema.prisma'], {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: schemaQualifiedDatabaseUrl(hospital.schemaName) },
      });
      console.log('ok');
    } catch (err: unknown) {
      failures++;
      const message = err instanceof Error ? err.message : String(err);
      console.log('FAILED');
      console.error(`    ${message}`);
    }
  }

  await platform.$disconnect();

  if (failures > 0) {
    console.error(`\n${failures} of ${hospitals.length} tenant migration(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${hospitals.length} tenant schema(s) migrated successfully.`);
}

main().catch((e) => {
  console.error('migrate-all-tenants crashed:', e);
  process.exit(1);
});
