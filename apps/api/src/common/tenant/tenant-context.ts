import { AsyncLocalStorage } from 'async_hooks';
import { PrismaClient } from '@prisma/client';

export interface TenantContext {
  hospitalId: string;
  schemaName: string;
  prismaClient: PrismaClient;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Returns the tenant context for the current request. Throws if called
 * outside a request that went through TenantResolutionMiddleware (e.g. a
 * cron job or health check) — those call sites must set their own context
 * explicitly via runWithTenant() before touching PrismaService.
 */
export function getTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error(
      'No tenant context set for this execution. Any code path that uses PrismaService ' +
        'outside an HTTP request routed through TenantResolutionMiddleware must wrap itself ' +
        'in runWithTenant(...) first.',
    );
  }
  return ctx;
}

export function hasTenantContext(): boolean {
  return tenantStorage.getStore() !== undefined;
}

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return tenantStorage.run(ctx, fn);
}
