import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacGuard } from './rbac.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSION_KEY } from '../decorators/permissions.decorator';

interface StubUser {
  roleName: string;
  permissions?: { resource: string; action: string }[];
  type?: 'hospital' | 'platform';
}

/**
 * Builds an ExecutionContext whose reflector metadata and request user are
 * fixed, so each case states exactly one thing about the guard.
 */
function contextFor(user: StubUser | undefined) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardWith(metadata: { roles?: string[]; permission?: { resource: string; action: string } }) {
  const reflector = {
    getAllAndOverride: (key: unknown) => {
      if (key === ROLES_KEY) return metadata.roles;
      if (key === PERMISSION_KEY) return metadata.permission;
      return undefined;
    },
  } as unknown as Reflector;

  return new RbacGuard(reflector);
}

describe('RbacGuard', () => {
  const readEmployee = { resource: 'Employee', action: 'read' };

  describe('unconditional bypass', () => {
    it('grants the platform Super Admin access without any matching permission', () => {
      const guard = guardWith({ permission: readEmployee });
      const ctx = contextFor({ roleName: 'SuperAdmin', permissions: [], type: 'platform' });

      expect(guard.canActivate(ctx)).toBe(true);
    });

    // Regression: the bypass used to be keyed off a role-NAME string, which a
    // caller could spoof (or which could re-appear after the hospital-local
    // SuperAdmin role was retired). It must now require the verified
    // `type: 'platform'` claim from the platform JWT, not the display name.
    it('does NOT bypass on a "SuperAdmin" role name alone without type: platform', () => {
      const guard = guardWith({ permission: readEmployee });
      const ctx = contextFor({ roleName: 'SuperAdmin', permissions: [], type: 'hospital' });

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    // Regression: Administrator previously short-circuited the guard alongside
    // SuperAdmin, which made the two roles indistinguishable and meant
    // Administrator's permission rows were never consulted.
    it('does NOT let Administrator bypass a permission it lacks', () => {
      const guard = guardWith({ permission: { resource: 'ServicePrice', action: 'create' } });
      const ctx = contextFor({ roleName: 'Administrator', permissions: [readEmployee] });

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('lets Administrator through on a permission it actually holds', () => {
      const guard = guardWith({ permission: readEmployee });
      const ctx = contextFor({ roleName: 'Administrator', permissions: [readEmployee] });

      expect(guard.canActivate(ctx)).toBe(true);
    });

    // The guard previously also matched a legacy literal 'Admin' role that is
    // not among the seeded roles; it must not be a way in.
    it('does NOT treat a legacy "Admin" role name as privileged', () => {
      const guard = guardWith({ permission: readEmployee });
      const ctx = contextFor({ roleName: 'Admin', permissions: [] });

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  describe('permission matching', () => {
    it('honours a wildcard resource and action', () => {
      const guard = guardWith({ permission: { resource: 'Anything', action: 'delete' } });
      const ctx = contextFor({ roleName: 'Reception', permissions: [{ resource: '*', action: '*' }] });

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('rejects a matching resource with the wrong action', () => {
      const guard = guardWith({ permission: { resource: 'Employee', action: 'create' } });
      const ctx = contextFor({ roleName: 'Reception', permissions: [readEmployee] });

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('rejects a user with no permissions at all', () => {
      const guard = guardWith({ permission: readEmployee });
      const ctx = contextFor({ roleName: 'Nurse' });

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  describe('role matching', () => {
    it('allows a listed role', () => {
      const guard = guardWith({ roles: ['Pathologist', 'LabTechnician'] });
      expect(guard.canActivate(contextFor({ roleName: 'Pathologist' }))).toBe(true);
    });

    it('rejects an unlisted role', () => {
      const guard = guardWith({ roles: ['Pathologist'] });
      expect(() => guard.canActivate(contextFor({ roleName: 'LabTechnician' }))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('guard preconditions', () => {
    it('allows handlers that declare neither roles nor permissions', () => {
      const guard = guardWith({});
      expect(guard.canActivate(contextFor(undefined))).toBe(true);
    });

    it('rejects a guarded handler when the request carries no user', () => {
      const guard = guardWith({ permission: readEmployee });
      expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
    });
  });
});
