import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { getTenantContext } from '../tenant/tenant-context';

// Never $connect()-ed -- exists purely so the Proxy below can ask "is this a
// real Prisma property?" without needing a tenant context to already exist.
// NestJS (and JS itself, e.g. thenable checks) probe arbitrary property names
// on every provider instance right after construction -- during app
// bootstrap, outside any request -- so the trap must NOT call
// getTenantContext() for those, only for genuine Prisma model/method access.
const PRISMA_SHAPE_REFERENCE = new PrismaClient();

/**
 * Builds the tenant-routing Proxy that stands in for PrismaService at
 * runtime. Every existing `constructor(private prisma: PrismaService)` in
 * the codebase keeps working unchanged: the Proxy's `get` trap re-resolves
 * the active tenant's PrismaClient (from AsyncLocalStorage, set by
 * TenantResolutionMiddleware per request) on every property access, which is
 * what makes per-request tenant switching work without paying NestJS's
 * Scope.REQUEST DI-subtree cost. Exported standalone (not inlined in the
 * provider below) so it can be exercised directly in tests without a full
 * Nest bootstrap.
 */
function isRealPrismaProperty(prop: string | symbol): boolean {
  // `in` walks the whole prototype chain, so universal Object.prototype
  // members (toString, constructor, hasOwnProperty, ...) pass this check on
  // ANY object, including our empty Proxy target -- and real library code
  // (e.g. @nestjs/schedule's provider discovery, which calls
  // Object.getPrototypeOf(instance) and walks its method names) genuinely
  // probes those during app bootstrap. Excluding Object.prototype's own
  // members is what keeps this trap from firing for that kind of generic
  // introspection while still catching every genuine Prisma model/method.
  return prop in PRISMA_SHAPE_REFERENCE && !(prop in Object.prototype);
}

export function createTenantAwarePrismaProxy(): PrismaService {
  return new Proxy({} as PrismaService, {
    get(_target, prop, _receiver) {
      if (!isRealPrismaProperty(prop)) {
        return undefined;
      }
      const client = getTenantContext().prismaClient;
      const value = (client as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  });
}

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: createTenantAwarePrismaProxy,
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
