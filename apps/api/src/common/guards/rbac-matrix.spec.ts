import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { PERMISSION_GRANTS } from '../../../prisma/seed';

/**
 * P8 — RBAC permission matrix sweep.
 *
 * `RbacGuard` (rbac.guard.spec.ts) is proven correct in isolation: given a
 * handler's declared requirement and a user's permissions, it decides right.
 * What that unit test cannot see is the other half of the system — whether
 * every real HTTP handler actually *carries* a requirement, and whether every
 * requirement it carries is actually *grantable* to someone.
 *
 * This test statically parses every controller in src/ and checks both
 * directions of that gap:
 *
 *  1. Every handler is either @Public(), carries @RequirePermission(...) or
 *     @Roles(...), or is named in the ALLOWED_WITHOUT_GUARD list below with a
 *     stated reason. Anything else is a handler nobody remembered to guard —
 *     exactly the shape of bug found live during this sweep: GET/POST
 *     /doctors were marked @Public() ("keeping simple for demo"), so an
 *     unauthenticated caller could list every doctor and — via POST — create
 *     a fully working login account with a guessable password. Both are now
 *     gated behind RequirePermission('Doctor', 'read'|'create').
 *
 *  2. Every resource:action a handler requires is actually granted to at
 *     least one role in prisma/seed.ts's PERMISSION_GRANTS. A permission
 *     required by code but granted to nobody is unreachable by anyone but
 *     SuperAdmin — almost always a typo'd resource/action string or a grant
 *     the seed forgot to add for a newly built feature.
 */

const SRC_ROOT = path.resolve(__dirname, '..', '..');

const HTTP_METHOD_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);

interface HandlerInfo {
  file: string; // relative to src/, forward-slashed
  method: string;
  isPublic: boolean;
  hasRoles: boolean;
  requirePermission: { resource: string; action: string } | null;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function findControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findControllerFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.controller.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function decoratorsOf(node: ts.HasDecorators): readonly ts.Decorator[] {
  return ts.getDecorators(node) ?? [];
}

function decoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  return undefined;
}

function stringArgsOf(decorator: ts.Decorator): string[] {
  const expr = decorator.expression;
  if (!ts.isCallExpression(expr)) return [];
  return expr.arguments.filter(ts.isStringLiteral).map((a) => a.text);
}

function extractHandlers(file: string): HandlerInfo[] {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const relFile = toPosix(path.relative(SRC_ROOT, file));
  const handlers: HandlerInfo[] = [];

  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    const classDecorators = decoratorsOf(statement);
    const isController = classDecorators.some((d) => decoratorName(d) === 'Controller');
    if (!isController) continue;

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
      const methodDecorators = decoratorsOf(member);
      const isHandler = methodDecorators.some((d) => {
        const name = decoratorName(d);
        return name !== undefined && HTTP_METHOD_DECORATORS.has(name);
      });
      if (!isHandler) continue;

      const isPublic = methodDecorators.some((d) => decoratorName(d) === 'Public');
      const hasRoles = methodDecorators.some((d) => decoratorName(d) === 'Roles');
      const permissionDecorator = methodDecorators.find((d) => decoratorName(d) === 'RequirePermission');
      const permissionArgs = permissionDecorator ? stringArgsOf(permissionDecorator) : [];

      handlers.push({
        file: relFile,
        method: member.name.text,
        isPublic,
        hasRoles,
        requirePermission:
          permissionArgs.length === 2 ? { resource: permissionArgs[0], action: permissionArgs[1] } : null,
      });
    }
  }

  return handlers;
}

const allHandlers = findControllerFiles(SRC_ROOT).flatMap(extractHandlers);

/**
 * Handlers that intentionally carry neither @Public() nor a permission
 * requirement: reachable by any *authenticated* user (JwtAuthGuard still
 * applies), because the resource being read is the caller's own identity,
 * not hospital data. Every entry needs a one-line reason; the test fails
 * the moment this list and the code disagree, in either direction.
 */
const ALLOWED_WITHOUT_GUARD: { file: string; method: string; reason: string }[] = [
  {
    file: 'modules/auth/auth.controller.ts',
    method: 'getProfile',
    reason: 'GET /auth/me returns the caller\'s own token claims — any authenticated user, by definition.',
  },
  {
    file: 'modules/dashboard/dashboard.controller.ts',
    method: 'getMetrics',
    reason:
      'Hospital-wide aggregate counts only (visits/beds/stock/requisitions/charges), never an individual ' +
      'record — every role with Dashboard in its sidebar needs this, including roles with no Employee ' +
      'permission, so JwtAuthGuard alone is the correct bar (see the class-level comment on DashboardController).',
  },
  {
    file: 'modules/platform/hospitals.controller.ts',
    method: 'list',
    reason:
      'Platform (Super Admin) only, enforced by the controller-level @UseGuards(PlatformOnlyGuard) rather ' +
      'than a hospital-local @RequirePermission/@Roles grant, since no hospital role should ever be able to ' +
      'reach this regardless of permissions — RBAC permission rows are a hospital-local concept.',
  },
  {
    file: 'modules/platform/hospitals.controller.ts',
    method: 'getById',
    reason: 'Same as list() above — enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
  {
    file: 'modules/platform/hospitals.controller.ts',
    method: 'create',
    reason: 'Same as list() above — enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
  {
    file: 'modules/platform/hospitals.controller.ts',
    method: 'update',
    reason: 'Same as list() above — enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
  {
    file: 'modules/platform/hospitals.controller.ts',
    method: 'setStatus',
    reason: 'Same as list() above — enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
  {
    file: 'modules/platform/hospitals.controller.ts',
    method: 'resetPassword',
    reason: 'Same as list() above — enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
  {
    file: 'modules/platform/hospitals.controller.ts',
    method: 'remove',
    reason: 'Same as list() above — enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
  {
    file: 'modules/platform/hospital-admins.controller.ts',
    method: 'list',
    reason: 'Platform (Super Admin) only, enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
  {
    file: 'modules/platform/hospital-admins.controller.ts',
    method: 'create',
    reason: 'Platform (Super Admin) only, enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
  {
    file: 'modules/platform/hospital-admins.controller.ts',
    method: 'setActive',
    reason: 'Platform (Super Admin) only, enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
  {
    file: 'modules/platform/platform-admins.controller.ts',
    method: 'list',
    reason: 'Platform (Super Admin) only, enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
  {
    file: 'modules/platform/platform-admins.controller.ts',
    method: 'create',
    reason: 'Platform (Super Admin) only, enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
  {
    file: 'modules/platform/platform-admins.controller.ts',
    method: 'setActive',
    reason: 'Platform (Super Admin) only, enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
  {
    file: 'modules/platform/platform-audit-log.controller.ts',
    method: 'list',
    reason: 'Platform (Super Admin) only, enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
  {
    file: 'modules/platform/platform-dashboard.controller.ts',
    method: 'getSummary',
    reason: 'Platform (Super Admin) only, enforced by @UseGuards(PlatformOnlyGuard) at the controller level.',
  },
];

/**
 * Handlers marked @Public() — reachable with no auth token at all. Being
 * @Public() is a deliberate, visible escape hatch, so a handler that carries
 * it never shows up as "unguarded" above; but that same visibility is exactly
 * what let GET/POST /doctors sit open in production ("keeping simple for
 * demo") without ever tripping a test. This list is the other half of the
 * fix: every @Public() handler must be named here with a reason, so marking
 * a new one — or a sensitive one — is a diff someone has to write down, not
 * a decorator that quietly slips past review.
 */
const ALLOWED_PUBLIC: { file: string; method: string; reason: string }[] = [
  {
    file: 'health/health.controller.ts',
    method: 'check',
    reason: 'Infrastructure health probe (load balancer / Docker healthcheck) — must work with no credentials.',
  },
  {
    file: 'modules/auth/auth.controller.ts',
    method: 'login',
    reason: 'Credential exchange — the caller has no token yet by definition.',
  },
  {
    file: 'modules/auth/auth.controller.ts',
    method: 'refreshTokens',
    reason: 'Access-token renewal from a refresh token — the access token may already be expired.',
  },
  {
    file: 'modules/auth/branding.controller.ts',
    method: 'getBranding',
    reason: 'Hospital name/tagline/colour shown on the public login screen before any auth exists.',
  },
];

describe('RBAC permission matrix (P8 static sweep)', () => {
  it('found at least one controller to check (sanity guard against a broken scan)', () => {
    expect(allHandlers.length).toBeGreaterThan(50);
  });

  it('every HTTP handler is @Public(), permission-guarded, role-guarded, or explicitly allow-listed', () => {
    const unguarded = allHandlers.filter((h) => !h.isPublic && !h.requirePermission && !h.hasRoles);

    const actual = unguarded.map((h) => `${h.file}#${h.method}`).sort();
    const expected = ALLOWED_WITHOUT_GUARD.map((a) => `${a.file}#${a.method}`).sort();

    // A mismatch here is either a newly-added endpoint nobody guarded, or a
    // stale allow-list entry for a handler that no longer exists / is now
    // guarded — both are worth a human looking at, so both fail loudly
    // instead of the list silently drifting from reality.
    expect(actual).toEqual(expected);
  });

  it('every @Public() handler is explicitly named and justified in ALLOWED_PUBLIC', () => {
    const publicHandlers = allHandlers.filter((h) => h.isPublic);

    const actual = publicHandlers.map((h) => `${h.file}#${h.method}`).sort();
    const expected = ALLOWED_PUBLIC.map((a) => `${a.file}#${a.method}`).sort();

    // Same both-directions guarantee as the unguarded-handler check: a new
    // @Public() handler with no matching entry fails here until someone
    // writes down why it needs to be reachable with no auth token at all.
    expect(actual).toEqual(expected);
  });

  it('every @RequirePermission(resource, action) is actually grantable to some role', () => {
    const required = allHandlers
      .filter((h): h is HandlerInfo & { requirePermission: { resource: string; action: string } } =>
        h.requirePermission !== null,
      )
      .map((h) => ({ ...h.requirePermission, file: h.file, method: h.method }));

    const isGranted = (resource: string, action: string) =>
      PERMISSION_GRANTS.some(
        (g) => (g.resource === '*' || g.resource === resource) && (g.action === '*' || g.action === action),
      );

    const unreachable = required.filter((r) => !isGranted(r.resource, r.action));

    expect(
      unreachable.map((r) => `${r.file}#${r.method} requires ${r.resource}:${r.action}, granted to nobody`),
    ).toEqual([]);
  });

  // The universal wildcard used to be a seeded 'SuperAdmin' role's permission
  // row. That role is retired: cross-hospital "sees everything" access is now
  // exclusively a platform-JWT property (RbacGuard's `type === 'platform'`
  // bypass), never a row in this table. No hospital-local role should ever
  // carry resource:'*', action:'*' again.
  it('no seeded role carries the universal wildcard grant', () => {
    const wildcardRoles = PERMISSION_GRANTS.filter((g) => g.resource === '*' && g.action === '*').map(
      (g) => g.roleName,
    );
    expect(wildcardRoles).toEqual([]);
  });
});
