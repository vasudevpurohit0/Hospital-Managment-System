import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Carried on an access token minted by AccountLifecycleService.impersonate()
 * instead of a real login. The token's `sub`/`roleId`/`roleName`/
 * `tokenVersion` etc. are the TARGET user's own -- everything RbacGuard and
 * every service already checks (permissions, hospital scoping) evaluates as
 * if the target had logged in themselves, so effective privileges are never
 * the impersonator's. This claim exists purely so the original identity can
 * still be recovered: for the "who is really behind this" banner, for
 * ending the session, and for audit attribution (see
 * TenantClientFactory's Prisma middleware, which reads this off the tenant
 * context to stamp `impersonatorActorId`/`impersonatorRoleLabel` onto every
 * audit_logs row written during the session).
 */
export interface ImpersonationClaims {
  /** Correlates the started/ended audit events and this session's own token. */
  sessionId: string;
  /** Tenant `User.id` for a Hospital Administrator impersonator, or a PlatformUser id for a Super Admin impersonator -- never trust this alone without `impersonatorType` to know which. */
  impersonatorId: string;
  impersonatorType: 'hospital' | 'platform';
  impersonatorRoleName: string;
  impersonatorIdentifier: string;
  startedAt: string;
}

export interface AuthenticatedUser {
  id: string;
  identifier: string;
  roleId: string;
  roleName: string;
  permissions: { resource: string; action: string }[];
  /** Present for hospital-staff tokens; absent for platform tokens. */
  hospitalId?: string;
  /** Discriminates a hospital-staff token from a global Super Admin (platform) token. */
  type: 'hospital' | 'platform';
  /** Forces every request except a small allowlist to be rejected until they change it (RbacGuard). Absent/false for platform users. */
  mustChangePassword?: boolean;
  /** Present only when this request is running under an impersonation session -- see ImpersonationClaims. */
  impersonation?: ImpersonationClaims;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    return data ? user?.[data] : user;
  },
);
