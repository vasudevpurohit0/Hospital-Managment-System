import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { hasTenantContext, getTenantContext } from './tenant-context';

const MAX_CACHED_CLIENTS = Number(process.env.TENANT_CLIENT_CACHE_SIZE || 20);
const PER_TENANT_CONNECTION_LIMIT = Number(process.env.TENANT_CONNECTION_LIMIT || 5);

/**
 * Lazily creates and LRU-caches one PrismaClient per tenant Postgres schema.
 * Schema selection is purely a connection-string concern (`?schema=<name>`)
 * -- the underlying generated client (apps/api/prisma/schema.prisma) is the
 * same for every tenant, only the target schema differs.
 */
@Injectable()
export class TenantClientFactory implements OnModuleDestroy {
  private readonly logger = new Logger(TenantClientFactory.name);
  // Map preserves insertion order, which is what makes the delete+re-insert
  // dance below work as a simple LRU without a separate library.
  private readonly cache = new Map<string, PrismaClient>();

  async getClient(schemaName: string): Promise<PrismaClient> {
    const existing = this.cache.get(schemaName);
    if (existing) {
      this.cache.delete(schemaName);
      this.cache.set(schemaName, existing);
      return existing;
    }

    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) {
      throw new Error('DATABASE_URL is not set');
    }
    const url = new URL(baseUrl);
    url.searchParams.set('schema', schemaName);
    url.searchParams.set('connection_limit', String(PER_TENANT_CONNECTION_LIMIT));

    const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    this.registerImpersonationAuditMiddleware(client);
    await client.$connect();
    this.logger.log(`Connected tenant client for schema="${schemaName}"`);

    this.cache.set(schemaName, client);
    if (this.cache.size > MAX_CACHED_CLIENTS) {
      const oldestKey = this.cache.keys().next().value as string;
      const oldest = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      oldest
        ?.$disconnect()
        .catch((err) => this.logger.warn(`Error disconnecting evicted client "${oldestKey}": ${err}`));
      this.logger.log(`Evicted tenant client for schema="${oldestKey}" (cache size limit reached)`);
    }

    return client;
  }

  /**
   * Auto-attributes every `audit_logs` row written during an impersonation
   * session, so the dozens of existing `auditLog.create(...)` call sites
   * across the app (opd.service.ts, account-lifecycle.service.ts, billing,
   * admissions, ...) don't each need to be individually rewritten to thread
   * "am I impersonating right now" through. `actorUserId`/`actorRole` on
   * these rows are already, correctly, the impersonated (target) user --
   * this only adds who was impersonating them, read off the same
   * AsyncLocalStorage tenant context TenantResolutionMiddleware already
   * populates from the request's JWT. A caller that explicitly sets these
   * two fields itself (the impersonation started/ended lifecycle events
   * themselves, where the impersonator IS the actor) is left untouched --
   * only an `undefined` value here is filled in.
   */
  private registerImpersonationAuditMiddleware(client: PrismaClient): void {
    client.$use(async (params, next) => {
      if (params.model === 'AuditLog' && (params.action === 'create' || params.action === 'createMany')) {
        const ctx = hasTenantContext() ? getTenantContext() : undefined;
        const impersonation = ctx?.impersonation;
        if (impersonation) {
          const stamp = (data: Record<string, unknown> | undefined) => {
            if (!data) return;
            if (data.impersonatorActorId === undefined) {
              data.impersonatorActorId = impersonation.impersonatorId;
            }
            if (data.impersonatorRoleLabel === undefined) {
              data.impersonatorRoleLabel =
                impersonation.impersonatorType === 'platform'
                  ? `SuperAdmin (${impersonation.impersonatorIdentifier})`
                  : impersonation.impersonatorRoleName;
            }
          };
          if (params.action === 'create') {
            stamp(params.args?.data);
          } else if (Array.isArray(params.args?.data)) {
            params.args.data.forEach(stamp);
          }
        }
      }
      return next(params);
    });
  }

  async onModuleDestroy() {
    await Promise.all(
      [...this.cache.values()].map((c) => c.$disconnect().catch(() => undefined)),
    );
  }
}
