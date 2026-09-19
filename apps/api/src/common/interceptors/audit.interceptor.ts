import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { hasTenantContext } from '../tenant/tenant-context';
import { parseUserAgent, extractClientIp } from '../audit/request-meta.util';
import { classifySeverity } from '../audit/severity.util';
import { diffChangedFields, buildDescription } from '../audit/describe.util';
import { redactSensitiveFields } from '../audit/redact.util';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    // Only audit mutating state-changing HTTP methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const user = request.user as AuthenticatedUser | undefined;
    // Extract entity type from route path (e.g., /api/employees -> Employee)
    const pathSegments = request.route?.path
      ? request.route.path.split('/').filter(Boolean)
      : request.url.split('?')[0].split('/').filter(Boolean);

    // Skip auth routes or health check from domain audit logging
    if (pathSegments.includes('auth') || pathSegments.includes('health')) {
      return next.handle();
    }

    const entityType =
      pathSegments.length > 1
        ? pathSegments[1].charAt(0).toUpperCase() + pathSegments[1].slice(1).replace(/s$/, '')
        : 'UnknownEntity';

    const action = `${entityType.toLowerCase()}.${method.toLowerCase()}`;
    const beforeSnapshot = method === 'PUT' || method === 'PATCH' ? request.body : null;
    const ipAddress = extractClientIp(request);
    const { browser, os, device } = parseUserAgent(request.headers?.['user-agent']);

    return next.handle().pipe(
      tap({
        next: async (responseBody: unknown) => {
          // Platform-scoped mutations (e.g. POST /platform/hospitals,
          // PATCH /platform/admins/:id/active) deliberately carry no hospital,
          // so TenantResolutionMiddleware never sets a tenant context for
          // them. The tenant-aware PrismaService proxy throws without one, so
          // there is no schema to record into: skip rather than reporting a
          // failure for every platform action.
          if (!hasTenantContext()) {
            this.logger.debug(`Skipped AuditLog (no tenant context): ${action} on ${entityType}`);
            return;
          }

          try {
            const bodyObj = responseBody as Record<string, unknown> | null;
            const entityId =
              (bodyObj?.id as string) ||
              request.params?.id ||
              request.body?.id ||
              '00000000-0000-0000-0000-000000000000';

            const changedFields = diffChangedFields(beforeSnapshot, responseBody);
            const status = 'SUCCESS' as const;
            const severity = classifySeverity({ entityType, action, status });
            const description = buildDescription({
              method,
              entityType,
              entityId,
              requestBody: request.body,
              responseBody,
              changedFields,
            });

            await this.prisma.auditLog.create({
              data: {
                actorUserId: user?.id || null,
                actorRole: user?.roleName || 'Anonymous',
                action,
                entityType,
                entityId,
                // Redacted AFTER changedFields/description are computed above
                // (from the real, unredacted data) so "temporaryPassword
                // changed" still shows correctly as a field NAME -- only the
                // stored snapshot's VALUES are ever replaced.
                beforeSnapshot: beforeSnapshot ? redactSensitiveFields(JSON.parse(JSON.stringify(beforeSnapshot))) : null,
                afterSnapshot: responseBody ? redactSensitiveFields(JSON.parse(JSON.stringify(responseBody))) : null,
                changedFields,
                status,
                severity,
                description,
                ipAddress,
                browser,
                os,
                device,
              },
            });

            this.logger.log(
              `📝 AuditLog written: [${user?.roleName || 'System'}] ${action} on ${entityType} (${entityId})`,
            );
          } catch (err) {
            this.logger.error(`Failed to write AuditLog: ${err}`);
          }
        },
        error: async (err: unknown) => {
          if (!hasTenantContext()) return;

          try {
            const entityId = request.params?.id || request.body?.id || '00000000-0000-0000-0000-000000000000';
            const errorMessage = err instanceof Error ? err.message : 'Request failed';
            const status = 'FAILURE' as const;
            const severity = classifySeverity({ entityType, action, status });

            await this.prisma.auditLog.create({
              data: {
                actorUserId: user?.id || null,
                actorRole: user?.roleName || 'Anonymous',
                action,
                entityType,
                entityId,
                beforeSnapshot: beforeSnapshot ? redactSensitiveFields(JSON.parse(JSON.stringify(beforeSnapshot))) : null,
                status,
                severity,
                description: `Failed to ${method === 'DELETE' ? 'delete' : method === 'POST' ? 'create' : 'update'} ${entityType.toLowerCase()}: ${errorMessage}`,
                ipAddress,
                browser,
                os,
                device,
              },
            });
          } catch (writeErr) {
            this.logger.error(`Failed to write failure AuditLog: ${writeErr}`);
          }
        },
      }),
    );
  }
}
