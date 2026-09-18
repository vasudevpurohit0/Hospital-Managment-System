import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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

  async onModuleDestroy() {
    await Promise.all(
      [...this.cache.values()].map((c) => c.$disconnect().catch(() => undefined)),
    );
  }
}
