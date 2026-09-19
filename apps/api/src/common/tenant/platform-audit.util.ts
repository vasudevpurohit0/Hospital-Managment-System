import { Logger } from '@nestjs/common';
import { PlatformPrismaService } from './platform-prisma.service';

const logger = new Logger('PlatformAuditLog');

/**
 * Records a platform-level administrative action (create/suspend/delete a
 * hospital, hospital-admin or platform-admin CRUD). Distinct from the
 * tenant-scoped `AuditLog` the global `AuditInterceptor` writes for
 * hospital-schema mutations: platform mutations carry no hospital-schema
 * tenant context (`TenantResolutionMiddleware` only enters tenant context for
 * a request that resolves to a specific hospital), so that interceptor
 * always skips them -- this was the actual gap: every cross-hospital Super
 * Admin *data read* was already logged (see TenantResolutionMiddleware), but
 * no platform *administrative action* was, anywhere.
 *
 * Awaited (not fire-and-forget) so ordering is deterministic for callers/tests,
 * but wrapped so a logging failure never fails the underlying action --
 * losing an audit row is preferable to blocking a legitimate hospital
 * suspend/admin-deactivate request.
 */
export async function recordPlatformAuditLog(
  platformPrisma: PlatformPrismaService,
  params: {
    platformUserId: string;
    action: string;
    hospitalId?: string | null;
    resource?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await platformPrisma.platformAuditLog.create({
      data: {
        platformUserId: params.platformUserId,
        hospitalId: params.hospitalId ?? null,
        action: params.action,
        resource: params.resource ?? null,
        metadata: params.metadata as any,
      },
    });
  } catch (err) {
    logger.error(`Failed to write PlatformAuditLog for action "${params.action}": ${err}`);
  }
}
