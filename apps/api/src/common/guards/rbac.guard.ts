import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSION_KEY, PermissionRequirement } from '../decorators/permissions.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

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

    // If no roles or permissions specified, allow access
    if (!requiredRoles && !requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    if (!user || !user.roleName) {
      throw new ForbiddenException('Access denied: unauthenticated or missing user role');
    }

    // SuperAdmin & Administrator bypass role/permission checks
    if (
      user.roleName === 'SuperAdmin' ||
      user.roleName === 'Administrator' ||
      user.roleName === 'Admin'
    ) {
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
