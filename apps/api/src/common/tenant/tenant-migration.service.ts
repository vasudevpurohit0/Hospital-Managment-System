import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { PlatformPrismaService } from './platform-prisma.service';

const execFileAsync = promisify(execFile);

// apps/api/ -- same relative depth from __dirname in both ts-node
// (src/common/tenant) and compiled (dist/common/tenant) execution. Same
// resolution HospitalsService and scripts/migrate-all-tenants.ts use, so the
// Prisma CLI always runs with the migrations directory as its cwd-adjacent
// target regardless of how the server was started.
const API_ROOT = path.resolve(__dirname, '..', '..', '..');

// See HospitalsService for why the CLI entrypoint is invoked directly via
// `node` instead of shelling out to the `prisma` shim (no shell needed, on
// any platform).
const PRISMA_CLI_ENTRYPOINT = require.resolve('prisma/build/index.js');

// Same allowlist HospitalsService enforces before running raw DDL -- a row
// with an unexpected schemaName can never turn this into an arbitrary
// `--schema` target or a DATABASE_URL pointed at another schema.
const SCHEMA_NAME_RE = /^hospital_[a-z0-9_]+$/;

export interface TenantMigrationSummary {
  migrated: string[];
  failed: { schemaName: string; error: string }[];
  skipped: string[];
}

/**
 * Keeps every tenant schema (and the platform schema) on the latest
 * migration without operator intervention.
 *
 * Hospital creation already runs `migrate deploy` for the brand-new schema
 * (HospitalsService.createHospital), but that only covers migrations that
 * exist at onboarding time. Any migration added later -- e.g. the
 * impersonation-audit-columns migration that 500'd every audit-log write
 * until `migrate:all-tenants` was run by hand -- leaves all previously
 * onboarded tenants behind, and the new code fails against their stale
 * schemas at runtime. This service closes that gap: shortly after boot it
 * re-runs `prisma migrate deploy` (a no-op when there is nothing pending)
 * against the platform schema and every non-PROVISIONING tenant schema.
 *
 * Runs in the background on module init rather than blocking listen:
 * `migrate deploy` shells out to the Prisma CLI per schema (~seconds each),
 * which would otherwise delay every dev restart and every replica boot.
 * The tradeoff is a short window after a deploy where a not-yet-reconciled
 * tenant can still 500 on brand-new columns -- strictly better than today,
 * where that window never closes on its own. Deploy pipelines that need a
 * zero-drift cutover should still run `pnpm run migrate:all-tenants`
 * explicitly before shifting traffic.
 *
 * Never throws out of onModuleInit: a tenant whose migration fails keeps its
 * old schema (and its old failure mode), but must not take the whole API
 * down with it. Failures are logged loudly instead. Set
 * SKIP_STARTUP_MIGRATION=true to disable entirely (tests, read-only
 * environments).
 */
@Injectable()
export class TenantMigrationService implements OnModuleInit {
  private readonly logger = new Logger(TenantMigrationService.name);

  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  onModuleInit() {
    if (process.env.SKIP_STARTUP_MIGRATION === 'true') {
      this.logger.log('Startup tenant-migration reconciliation disabled via SKIP_STARTUP_MIGRATION=true.');
      return;
    }
    // Fire-and-forget on purpose (see class doc): reconcile() itself never
    // rejects, and this catch is belt-and-braces so an unexpected throw can
    // never surface as an unhandled rejection.
    void this.reconcile().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Startup tenant-migration reconciliation crashed: ${message}`);
    });
  }

  /**
   * Brings the platform schema and every live tenant schema up to date.
   * Safe to call repeatedly and concurrently with traffic: `migrate deploy`
   * only applies pending migrations (no-op otherwise) and serializes via
   * Postgres advisory locks; new columns in this project are always
   * nullable/defaulted so old and new code coexist during the window.
   */
  async reconcile(): Promise<TenantMigrationSummary> {
    const summary: TenantMigrationSummary = { migrated: [], failed: [], skipped: [] };

    try {
      await this.migratePlatformSchema();
      this.logger.log('Platform schema is up to date.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Platform schema migration failed (continuing with tenants): ${message}`);
    }

    let hospitals: { id: string; slug: string; schemaName: string }[];
    try {
      hospitals = await this.platformPrisma.hospital.findMany({
        // A PROVISIONING row's schema is owned by the creation flow
        // (createHospital/resumeProvisioning run their own migrate deploy);
        // touching it here could race an in-flight onboarding.
        where: { status: { not: 'PROVISIONING' } },
        select: { id: true, slug: true, schemaName: true },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Startup tenant-migration reconciliation aborted: cannot list hospitals: ${message}`);
      return summary;
    }

    for (const hospital of hospitals) {
      if (!SCHEMA_NAME_RE.test(hospital.schemaName)) {
        this.logger.error(
          `Skipping tenant migration for hospital "${hospital.slug}": invalid schemaName on record -- refusing to run DDL.`,
        );
        summary.skipped.push(hospital.schemaName);
        continue;
      }
      try {
        await this.migrateTenantSchema(hospital.schemaName);
        summary.migrated.push(hospital.schemaName);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Tenant migration failed for schema "${hospital.schemaName}" (hospital "${hospital.slug}"): ${message}`);
        summary.failed.push({ schemaName: hospital.schemaName, error: message });
      }
    }

    this.logger.log(
      `Startup tenant-migration reconciliation done: ${summary.migrated.length} migrated, ` +
        `${summary.failed.length} failed, ${summary.skipped.length} skipped.`,
    );
    return summary;
  }

  /** Applies pending platform (control-plane) migrations. Throws on failure. */
  async migratePlatformSchema(): Promise<void> {
    await execFileAsync(process.execPath, [PRISMA_CLI_ENTRYPOINT, 'migrate', 'deploy', '--schema=prisma/platform/schema.prisma'], {
      cwd: API_ROOT,
    });
  }

  /**
   * Applies pending tenant migrations to one schema. Also used by
   * HospitalsService during onboarding, so creation-time and startup-time
   * migration can never drift apart. Throws on failure -- callers decide
   * whether that aborts (onboarding) or is logged and skipped (reconcile).
   */
  async migrateTenantSchema(schemaName: string): Promise<void> {
    if (!SCHEMA_NAME_RE.test(schemaName)) {
      throw new Error(`Invalid schema name -- refusing to run DDL: ${schemaName}`);
    }
    await execFileAsync(process.execPath, [PRISMA_CLI_ENTRYPOINT, 'migrate', 'deploy', '--schema=prisma/schema.prisma'], {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: this.schemaQualifiedDatabaseUrl(schemaName) },
    });
  }

  private schemaQualifiedDatabaseUrl(schemaName: string): string {
    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) throw new Error('DATABASE_URL is not set');
    const url = new URL(baseUrl);
    url.searchParams.set('schema', schemaName);
    return url.toString();
  }
}
