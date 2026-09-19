import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSION_KEY, PermissionRequirement } from '../decorators/permissions.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Routes a `mustChangePassword` user may still reach. Path-prefix matched
 * against the request's own path (already includes the global `/api`
 * prefix), so this stays correct regardless of route ordering and needs no
 * per-controller decorator.
 */
const MUST_CHANGE_PASSWORD_ALLOWLIST = ['/api/auth/change-password', '/api/auth/me', '/api/auth/refresh', '/api/auth/logout'];

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const requiredPermission = this.reflector.getAllAndOverride<PermissionRequirement>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    // Forced first-login password change: blocks every hospital-staff
    // request except a small allowlist, regardless of whether the route
    // itself requires a specific permission -- checked ahead of the
    // "no requirement" early return below, since an un-permissioned route
    // (e.g. GET /auth/me) must be gated exactly the same as a permissioned one.
    if (user?.type === 'hospital' && user.mustChangePassword) {
      const path: string = request.path || request.originalUrl || request.url || '';
      const allowed = MUST_CHANGE_PASSWORD_ALLOWLIST.some((p) => path.startsWith(p));
      if (!allowed) {
        throw new ForbiddenException({
          message: 'You must change your password before continuing.',
          code: 'MUST_CHANGE_PASSWORD',
        });
      }
    }

    // If no roles or permissions specified, allow access
    if (!requiredRoles && !requiredPermission) {
      return true;
    }

    if (!user || !user.roleName) {
      throw new ForbiddenException('Access denied: unauthenticated or missing user role');
    }

    // The global Super Admin (a PlatformUser, authenticated via the separate
    // platform JWT -- see PlatformJwtStrategy) is the only caller that
    // bypasses role and permission checks. This used to be a hospital-local
    // 'SuperAdmin' DB role checked by name; that role is retired now that
    // cross-hospital access is a real platform-level concept, so the bypass
    // is keyed off the verified token type instead of a role-name string
    // (which a caller cannot spoof the way a role name on a stub object
    // could be).
    //
    // Administrator previously bypassed as well, which made it indistinguishable
    // from SuperAdmin and meant permission grants could not be reasoned about
    // for the role most widely handed out. Administrator now carries explicit
    // permission rows (see prisma/seed.ts) and is evaluated like any other role.
    if (user.type === 'platform') {
      return true;
    }

    // 1. Check Roles requirement if present
    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = requiredRoles.includes(user.roleName);
      if (!hasRole) {
        throw new ForbiddenException(
          `Access denied: required role (${requiredRoles.join(', ')}) missing. Current role: ${user.roleName}`,
        );
      }
    }

    // 2. Check Permission requirement if present
    if (requiredPermission) {
      const { resource, action } = requiredPermission;

      const hasPermission = user.permissions?.some(
        (p) =>
          (p.resource === '*' || p.resource === resource) &&
          (p.action === '*' || p.action === action),
      );

      if (!hasPermission) {
        throw new ForbiddenException(
          `Access denied: missing permission [${resource}:${action}] for role ${user.roleName}`,
        );
      }
    }

    return true;
  }
}
