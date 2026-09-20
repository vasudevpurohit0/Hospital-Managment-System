import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';

export interface PermissionRequirement {
  resource: string;
  action: string;
}

export const RequirePermission = (resource: string, action: string) =>
  SetMetadata(PERMISSION_KEY, { resource, action } as PermissionRequirement);

/** Same wildcard-matching rule RbacGuard enforces at the route level, exposed for a service/controller that needs to branch on a permission narrower than the one gating the whole endpoint (e.g. hiding billing figures from a caller who holds PatientHistory:read but not Charge:read). */
export function hasPermission(
  permissions: { resource: string; action: string }[] | undefined,
  resource: string,
  action: string,
): boolean {
  return !!permissions?.some(
    (p) => (p.resource === '*' || p.resource === resource) && (p.action === '*' || p.action === action),
  );
}
