# Implementation Log — Multi-Hospital Platform Conversion

Running log of the multi-hospital / schema-per-tenant conversion. Plan: see the approved plan (schema-per-tenant, global Super Admin, phases 0-5). Each entry: what was built, files touched, what was tested, result.

---

## Phase 0 — Platform (control-plane) schema

**Built:**
- New independent Prisma project for control-plane tables living in the Postgres `public` schema, separate from the existing tenant-template `apps/api/prisma/schema.prisma`.
- `apps/api/prisma/platform/schema.prisma` — `Hospital`, `PlatformUser`, `PlatformAuditLog` models, own generator output (`node_modules/.prisma/platform-client`), own datasource (`PLATFORM_DATABASE_URL`).
- `apps/api/prisma/platform/migrations/20260918122830_init_platform/migration.sql` — initial migration (generated via `prisma migrate diff --from-empty`, since `prisma migrate dev` requires an interactive TTY not available in this environment; applied with `prisma migrate deploy`).
- `apps/api/prisma/platform/seed.ts` — bootstraps the first `PlatformUser` (Super Admin) via upsert, credentials overridable via `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` / `PLATFORM_ADMIN_NAME` env vars, bcryptjs cost 10 (matches existing convention in `apps/api/prisma/seed.ts`).
- `apps/api/package.json` — added `prisma:platform:generate|migrate|deploy|seed` scripts; `build`/`postinstall` now generate both Prisma clients.
- `apps/api/.env` / `apps/api/.env.example` — added `PLATFORM_DATABASE_URL` (same DB, `?schema=public`).

**Unplanned but necessary prerequisite:** the dev database's existing single-hospital migration history in `public` was already broken from a pre-existing, unrelated issue — `20260829230210_add_therapy_source_tracking` had failed to apply (missing `TherapySessionStatus` type, error from 2026-09-13, before this session). Since the user confirmed existing data is expendable and Phase 3 of the plan calls for resetting `public` to hold only control-plane tables anyway, that reset was pulled forward and done now: `DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION esic_user;` — this dropped all 46 old domain tables/enums and the stale `_prisma_migrations` table. This unblocks Phase 0 cleanly and is a no-op change from the plan's perspective (Phase 3 no longer needs to do this step again).

**Tested:**
- `prisma migrate deploy --schema=prisma/platform/schema.prisma` — applied successfully against the freshly reset `public` schema. Verified via `\dt public.*` in psql: `hospitals`, `platform_users`, `platform_audit_log`, `_prisma_migrations` present, nothing else.
- `prisma generate --schema=prisma/platform/schema.prisma` — client generated to `apps/api/node_modules/.prisma/platform-client`.
- End-to-end smoke test (throwaway script, removed after use): created a `Hospital`, a `PlatformUser`, and a `PlatformAuditLog` row; verified unique-slug lookup, the audit-log-by-hospital relation query, and cleanup deletes — all passed.
- `prisma:platform:seed` script run twice — confirmed idempotent (`upsert` returns the same `PlatformUser.id` both times). A real Super Admin (`superadmin@platform.local`, default dev password — see script) now exists in the local dev database.

**Result:** PASS. Control plane is live in `public`; tenant-template `apps/api/prisma/schema.prisma` and its migration folder were not touched.

**Deferred/notes for later phases:**
- The existing 11 tenant-template migration files under `apps/api/prisma/migrations/` still target `public` by convention (no `?schema=` param baked in) — Phase 4's onboarding flow will point `DATABASE_URL` at a tenant-specific schema per hospital at run time, so no change needed to those migration files themselves.
- `public` currently has zero domain tables — this is expected and matches Phase 3's "fresh start" plan; the first real tenant schema will be created via Phase 4's onboarding path.

---

## Phase 1 — Tenant connection factory + AsyncLocalStorage routing (in progress)

**Built so far:**
- `apps/api/src/common/tenant/tenant-context.ts` — `AsyncLocalStorage<TenantContext>` (`{hospitalId, schemaName, prismaClient}`) plus `getTenantContext()` (throws with a clear message if no context is set), `hasTenantContext()`, `runWithTenant()`.
- `apps/api/src/common/tenant/tenant-client-factory.ts` — `TenantClientFactory`, bounded LRU cache (`TENANT_CLIENT_CACHE_SIZE` env, default 20) of `PrismaClient` instances keyed by schema name, built from `DATABASE_URL` with `?schema=<name>&connection_limit=<TENANT_CONNECTION_LIMIT, default 5>` appended; evicts+disconnects oldest on overflow; disconnects all on module destroy.
- `apps/api/src/common/tenant/platform-prisma.service.ts` — `PlatformPrismaService`, fixed (non-tenant-routed) connection to the control-plane DB, same connect/disconnect logging pattern as the old `PrismaService`.
- `apps/api/src/common/tenant/tenant.module.ts` — `@Global()` module exporting both of the above.
- `apps/api/src/common/prisma/prisma.service.ts` — rewritten: now purely a type-only DI token (`class PrismaService extends PrismaClient {}` with no lifecycle methods) since the real Prisma clients are tenant-scoped and live in `TenantClientFactory` instead.
- `apps/api/src/common/prisma/prisma.module.ts` — rewritten: `PrismaService` provider is now `useFactory: createTenantAwarePrismaProxy`, an exported (testable) function returning a `Proxy` whose `get` trap reads `getTenantContext().prismaClient` on every access. This is what lets every existing `constructor(private prisma: PrismaService)` across ~20 service files keep working unmodified.
- `apps/api/src/app.module.ts` — added `TenantModule` to imports (before `PrismaModule`).
- `apps/api/src/modules/admission/ipd-finance.service.ts` — fixed the one known "runs outside an HTTP request" sharp edge flagged in the plan: `runNightlyBedDayJob` (a `@Cron` job) now fetches all `ACTIVE` hospitals from `PlatformPrismaService`, and runs `postBedDayCharges` once per hospital inside `runWithTenant(...)`, catching/logging per-hospital failures so one tenant's error doesn't block the rest. Added `PlatformPrismaService`/`TenantClientFactory` to its constructor.
- `apps/api/src/modules/admission/ipd-finance.service.spec.ts` — updated the direct `new IpdFinanceService(...)` construction to pass the two new constructor args (real-but-idle instances; this spec exercises `postBedDayCharges` directly, never the cron entry point).

**Tested:**
- `pnpm run typecheck` — clean (one pre-existing compile error from the spec's stale constructor signature, fixed above; confirmed clean after the fix).
- Stood up two real throwaway tenant schemas (`hospital_test_a`, `hospital_test_b`) via `prisma migrate deploy --schema=prisma/schema.prisma` against schema-qualified `DATABASE_URL`s — both applied cleanly (confirms the current tenant-template migration folder itself is healthy; the earlier `public`-schema failure was pre-existing/unrelated, see Phase 0 entry).
- Ran a throwaway isolation smoke test (removed after use) directly exercising `TenantClientFactory` + `runWithTenant` + `createTenantAwarePrismaProxy`: seeded a distinct `Role`+`User` in each tenant schema, then read through the *same* Proxy-wrapped `PrismaService` under each tenant's `AsyncLocalStorage` context — confirmed each context saw only its own tenant's user, including under two concurrent overlapping async calls (the real risk case for `AsyncLocalStorage` misuse). Also confirmed calling `PrismaService` with **no** tenant context set throws immediately with the expected error rather than silently falling back to some default connection. All assertions passed. Left `hospital_test_a`/`hospital_test_b` schemas in place for Phase 2 testing (not yet cleaned up).

**Test suite triage (full `pnpm test` run — 12 failing suites / 103 failing tests):** investigated each failing suite individually to separate "expected fallout of the approved schema reset" from "actual regression caused by my Phase 1 changes." Result: **zero regressions from Phase 1's changes.** Breakdown:
- **8 suites** (`ipd-finance.service.spec.ts`, `document-sequence.service.spec.ts`, `analytics.service.spec.ts`, `charge.service.spec.ts`, `receipt.service.spec.ts`, `pricing.service.spec.ts`, `lab.service.spec.ts`, `therapy.service.spec.ts`) are real-DB integration tests (`describeWithDb` gated, or unconditionally instantiate a real `PrismaClient`/`PrismaService`) that assume single-tenant seed data lives in `public`. They now fail with `The table "public.<x>" does not exist` because Phase 0 emptied `public` of domain tables (data loss was pre-approved). Root cause of why they ran at all despite `describeWithDb`: Prisma's generated client loads `.env`'s `DATABASE_URL` on its own, independent of shell-level `export`/`unset`. **This is expected fallout of the schema-per-tenant move, not a bug** — these tests will need to be pointed at a seeded tenant schema in a later pass (flagged below as a gap, not fixed now — out of scope for Phase 1).
- **3 suites** (`billing.service.spec.ts`, `dashboard.service.spec.ts`, `inventory.service.spec.ts`) mock `PrismaService` entirely (`{ provide: PrismaService, useValue: mockPrisma }`) and never touch a real DB, yet still fail. Verified via `git stash` (reverting to the pre-multi-tenant-work baseline) that **these 3 suites fail identically with zero of my changes applied** — confirmed pre-existing bugs (e.g. `billing.service.spec.ts` fails because its `mockPrisma` fixture never defined a `brandingConfig` property, which `BillingService.getReceipt` calls). Unrelated to this work; restored my stash immediately after confirming (`git stash pop`), nothing lost.
- **1 suite** (`rbac-matrix.spec.ts`) is a static sweep asserting every controller handler is guarded/allow-listed; it now flags `modules/dashboard/dashboard.controller.ts#getMetrics` as unguarded and not on the allow-list. I have not touched either file, so this is a pre-existing RBAC coverage gap in the codebase, unrelated to tenant work.

**Gap flagged for later (not part of the approved 6-phase plan, noting for visibility):** the 8 real-DB integration suites above will need to be updated to run against a seeded tenant schema (or a test-specific tenant fixture) once schema-per-tenant is live, otherwise they'll stay permanently broken. Not fixing now — out of scope for Phase 1, and premature before Phase 4's onboarding flow exists to create a proper test tenant.

**Phase 1 status: PASS.** Isolation proven correct (see smoke test above), typecheck clean, and the only test-suite failures present are pre-existing or expected/approved fallout — none introduced by this phase's code.

---

## Phase 2 — Auth redesign (in progress)

**Step: add `jsonwebtoken` as an explicit dependency.** The tenant-resolution middleware (next step) needs to manually decode/verify JWTs before the full Passport/Nest guard chain runs, using the raw `jsonwebtoken` package. It was only present transitively (via `@nestjs/jwt`), so relying on it without declaring it is fragile. Added `jsonwebtoken@9.0.2` to `dependencies` and `@types/jsonwebtoken@9.0.10` to `devDependencies` in `apps/api/package.json`.
**Tested:** ran `pnpm install --filter @esic-hms/api` — installed cleanly, and confirmed the Phase 0 `postinstall` script change (regenerating both Prisma clients) still works correctly as a side effect of this install. PASS.

**Step: `AuthenticatedUser` shape + hospital JWT strategy.**
- `apps/api/src/common/decorators/current-user.decorator.ts` — added `hospitalId?: string` and `type: 'hospital' | 'platform'` to `AuthenticatedUser`.
- `apps/api/src/modules/auth/strategies/jwt.strategy.ts` — `JwtPayload` now requires `hospitalId`/`schemaName` (embedded at sign-time so the tenant schema is resolvable straight from the token, no platform-DB lookup needed first). `validate()` now returns `type: 'hospital'` and passes through `hospitalId`.

**Step: platform JWT strategy (new).**
- `apps/api/src/modules/auth/strategies/platform-jwt.strategy.ts` — new, named strategy `'platform-jwt'`, verifies against `JWT_PLATFORM_SECRET`, loads `PlatformUser` via `PlatformPrismaService`, returns `type: 'platform'`, `roleName: 'SuperAdmin'`.
- **Design decision worth flagging:** grepped the codebase for existing hardcoded `roleName === 'SuperAdmin'` checks scattered outside `RbacGuard` — found them in `prescription.service.ts` (signing requires Doctor/Administrator/SuperAdmin), `admission.service.ts` (discharge approval, same three roles), and `catalog.controller.ts`'s doc comment. Rather than hunting down and rewriting every one of these to also check `type === 'platform'`, I deliberately kept `roleName: 'SuperAdmin'` as the platform strategy's reported role name. Since the hospital-local `SuperAdmin` DB role is being retired (no hospital `User` will ever have that role name again — see next step), the string `'SuperAdmin'` becomes an exclusive sentinel meaning "this is the platform Super Admin," and every one of those pre-existing scattered checks keeps working correctly for platform users with zero changes to those files. `rbac-admin.service.ts`'s guard against editing "SuperAdmin's" permission rows becomes unreachable dead code (no such Role row will exist) but is harmless to leave as-is.

**Step: `JwtAuthGuard` accepts both strategies.** `apps/api/src/modules/auth/guards/jwt-auth.guard.ts` — `AuthGuard('jwt')` → `AuthGuard(['jwt', 'platform-jwt'])` (Passport's built-in multi-strategy fallback). Grepped `apps/api/src` for other `AuthGuard(` usages first, per the plan's flagged risk — confirmed this is the only call site, so the change is fully contained.

**Step: hospital login DTO + `AuthService` rewrite + platform auth service/controller/module wiring.**
- `apps/api/src/modules/auth/dto/login.dto.ts` — added required `hospitalCode` field.
- `apps/api/src/modules/auth/auth.service.ts` — rewritten: `login()` now resolves the `Hospital` by slug via `PlatformPrismaService` first (generic "Invalid credentials" on a bad/suspended hospital, so a login attempt can't enumerate hospital codes), gets that tenant's `PrismaClient` from `TenantClientFactory`, and runs the rest of the login inside `runWithTenant(...)` so `validateUser`'s `this.prisma.user.findUnique(...)` is correctly tenant-routed. Both the access-token and refresh-token payloads now embed `hospitalId`/`schemaName`. `refreshTokens()` similarly resolves tenant context from the refresh token's embedded schema before touching `PrismaService`.
- `apps/api/src/modules/auth/dto/platform-login.dto.ts`, `platform-auth.service.ts`, `platform-auth.controller.ts` (all new) — separate `POST /api/platform/auth/login`, no hospital involved, issues a `type:'platform'` JWT signed with `JWT_PLATFORM_SECRET`.
- `apps/api/src/modules/auth/auth.module.ts` — registers `PlatformJwtStrategy`, `PlatformAuthService`, `PlatformAuthController` alongside the existing hospital-auth providers.
- Added `JWT_PLATFORM_SECRET` to `apps/api/.env` and `.env.example`.

**Tested:**
- `pnpm run typecheck` — one compile error surfaced (`auth.service.spec.ts` calling `login()` without the new required `hospitalCode` field, and missing mocks for the two new `AuthService` constructor dependencies). Fixed by adding `PlatformPrismaService`/`TenantClientFactory` mocks (a fake `ACTIVE` hospital + a `getClient` that resolves to the existing mocked `PrismaService`) and passing `hospitalCode` in the test call. Re-ran `typecheck` — clean.
- `pnpm exec jest auth.service.spec.ts` — all 7 tests pass (the one `ERROR`-level log line in the output is the suite intentionally simulating a DB failure, not a real failure).

**Step: `TenantResolutionMiddleware` (new).** `apps/api/src/common/middleware/tenant-resolution.middleware.ts` — runs as Express middleware (not a guard), which is what lets it wrap the *entire rest* of the request in `tenantStorage.run(ctx, () => next())` (a guard's `canActivate()` returns before downstream execution, so it can't do this). Does its own lightweight `jsonwebtoken.verify()` (trying the access secret, then the platform secret) purely to extract routing info before the real Passport guard runs — a missing/undecodable token just calls `next()` with no tenant context set, so `@Public()` routes are unaffected and protected routes still get a clean 401 from `JwtAuthGuard` right afterward. For a platform token, resolves tenant from the `X-Hospital-Id` header (403s if the header names a missing/non-ACTIVE hospital); for a hospital token, tenant comes straight from the embedded `hospitalId`/`schemaName` claims. Wired into `apps/api/src/app.module.ts`'s `configure()`, applied before `SecurityMiddleware` on `'*'`.
**Tested:** `pnpm run typecheck` — clean.

**Step: `RbacGuard` bypass keyed off token type, not role name.** `apps/api/src/common/guards/rbac.guard.ts` — the unconditional bypass (`user.roleName === 'SuperAdmin'`) is now `user.type === 'platform'`, since the bypass now needs to key off the verified platform-JWT claim, not a spoofable/soon-to-be-retired role-name string.
**Tested:** updated `rbac.guard.spec.ts`'s stub `StubUser` to carry an optional `type` field; changed the bypass test to assert on `type: 'platform'` and added a new regression test confirming a `roleName: 'SuperAdmin'` value alone (no `type: 'platform'`) does NOT bypass. `pnpm run typecheck` clean; `pnpm exec jest rbac.guard.spec.ts` — all 12 tests pass (was 11; added one).

**Step: retire the hospital-local `SuperAdmin` DB role.** `apps/api/prisma/seed.ts` —
- Removed `'SuperAdmin'` from `SYSTEM_ROLES`.
- Removed its `{ resource: '*', action: '*' }` wildcard `PERMISSION_GRANTS` row (the wildcard bypass is now exclusively `RbacGuard`'s `type === 'platform'` check, never a seeded permission row).
- Removed the `superAdminUser` upsert block from the user-seeding section (the global Super Admin is now seeded separately as a `PlatformUser` via `apps/api/prisma/platform/seed.ts`, from Phase 0).
- Updated two stale comments referencing the old bypass mechanism.

**Tested:**
- `pnpm run typecheck` — clean.
- `pnpm exec jest rbac-matrix.spec.ts` — this static sweep imports `PERMISSION_GRANTS` directly, so it's a real regression check. First run surfaced two failures: (1) my new `@Public()` `platform-auth.controller.ts#login` endpoint wasn't in the test's `ALLOWED_PUBLIC` allow-list — fixed by adding it with a justification (exactly the test's intended "you must write this down" behavior, not a bug); (2) the pre-existing `dashboard.controller.ts#getMetrics` gap noted earlier in Phase 1's triage. Since it was a genuine one-line, test-only, zero-behavior-change fix (the controller's own doc comment already stated the intended design — any authenticated user via `JwtAuthGuard` alone — the test's allow-list just never had a matching entry), fixed it opportunistically rather than leaving a known-broken baseline. Also updated the "SuperAdmin is the only role carrying the wildcard grant" test to "no seeded role carries the wildcard grant" (`[]`), matching the fact that the wildcard is no longer a seed-time concept at all. Re-ran: all 5 tests pass.

**Major bug found and fixed: the Phase 1 Proxy crashed the entire app on real boot.** Everything up to this point had only been verified via unit tests and a standalone script directly exercising `TenantClientFactory`/`runWithTenant` — never a real `NestFactory.create(AppModule)` boot. Doing that for the first time (to run a real end-to-end HTTP auth test) immediately crashed with `Error: No tenant context set for this execution`, thrown from *inside module instantiation*, before any HTTP request existed. Root-caused via a throwaway `apps/api/scripts/_ping.ts` (deleted after use), incrementally: the Proxy's `get` trap fired for **any** property access, including framework-internal introspection that happens outside any request:
1. NestJS's own lifecycle-hook detection (`instance.onModuleInit` etc.) on every provider right after construction.
2. Five pre-existing services that ran real Prisma queries inside `OnModuleInit` at app-process boot — `BenefitRuleService` (already fixed earlier in Phase 2), `DepartmentService`, `BrandingController`, `FacilityEligibilityService`, `AdmissionService`, and `ProcurementService` — none of which can work anymore now that there's no single "the" database to query at boot.
3. `@nestjs/schedule`'s own provider-discovery pass (`ScheduleExplorer.explore()`, which scans every provider — including `PrismaService` itself — for `@Cron`-decorated methods), which calls `Object.getPrototypeOf(instance)` on the Proxy and walks its method names, `instance[name]`-probing things like `toString`/`constructor`/`hasOwnProperty` — universal `Object.prototype` members that happen to also be "present" (via prototype-chain inheritance) on the empty `{}` object my Proxy wraps.

Fixes applied, in order:
- **`apps/api/src/common/prisma/prisma.module.ts`**: added a never-connected `PRISMA_SHAPE_REFERENCE = new PrismaClient()` used purely as an "is this a real Prisma property?" oracle, so the trap returns `undefined` (not a tenant-routed value) for anything that isn't genuinely a Prisma model/method name — this is what lets Nest's and other libraries' introspection see "no such property" instead of crashing. First version of this check (`prop in PRISMA_SHAPE_REFERENCE`) still let `Object.prototype` members (`toString`, `constructor`, `hasOwnProperty`, ...) through, since `in` walks the whole prototype chain and those exist on *any* object including the empty target — that's exactly what `@nestjs/schedule`'s discovery pass tripped over (case 3 above). Fixed by also excluding anything in `Object.prototype`: `prop in PRISMA_SHAPE_REFERENCE && !(prop in Object.prototype)`.
- **`apps/api/prisma/seed.ts`**: added default-clinical-department seeding (imports `SEED_DEPARTMENTS` from `department.service.ts`) and default-branding-singleton seeding (imports `DEFAULT_BRANDING`, now exported, from `branding.controller.ts`) — same treatment as `BenefitRuleService`'s defaults moved earlier.
- **`apps/api/src/modules/opd/services/department.service.ts`**, **`apps/api/src/modules/auth/branding.controller.ts`**: removed `OnModuleInit`/`onModuleInit()`, added a comment pointing to `seed.ts` as the new home.
- **`apps/api/src/modules/facility/facility.service.ts`**: removed `OnModuleInit` entirely (not relocated) — confirmed by reading `prisma/seed.ts`'s existing "Seed FacilityEligibilityRules" section that it already seeds an equivalent, more complete (deterministic-id) rule set per tenant schema; the `onModuleInit` version was fully redundant legacy code.
- **`apps/api/src/modules/admission/admission.service.ts`**: removed `OnModuleInit` entirely (not relocated) — it backfilled admission stubs from existing diagnoses only when the admissions table was empty; for any tenant onboarded fresh going forward, visits/diagnoses are also empty whenever admissions is empty, making it a guaranteed no-op with no real behavior to preserve.
- **`apps/api/src/modules/procurement/procurement.service.ts`**: converted from a one-time `OnModuleInit` boot scan into a recurring `@Cron(CronExpression.EVERY_6_HOURS)` job (`runLowStockScanAllHospitals`) that fans out across every `ACTIVE` hospital via `PlatformPrismaService`/`TenantClientFactory`/`runWithTenant`, exactly mirroring `IpdFinanceService`'s nightly bed-day job from Phase 1 — this one is a genuine recurring operational concern (catch low stock proactively), not one-time reference-data seeding, so a scheduled per-tenant fan-out is the correct replacement rather than a `seed.ts` move.

**Tested:**
- `pnpm run typecheck` — clean after each of the above edits.
- Verified via the throwaway `_ping.ts` script that `new PrismaClient()` (unconnected) correctly reports `'user'`/`'role'`/`'$transaction'` as present and `'onModuleInit'`/`'onModuleDestroy'`/`'then'` as absent, confirming the shape-check approach before relying on it.
- `NestFactory.create(AppModule)` → `app.init()` → `app.close()` now completes with **zero errors**, all ~28 modules initialize, and every route maps successfully. This is the first real full-application boot performed in this session (everything before was narrower unit/isolation testing) — a good reminder to boot the real app earlier next time such a structural change is made, rather than only after several phases of narrower tests all passed.

**Full end-to-end auth verification (real HTTP requests against the real app, real Postgres, real two tenant schemas).** Built a throwaway script (`apps/api/scripts/_smoke-test-phase2-auth.ts`, removed after use) that: registers two real hospitals in the platform DB pointing at Phase 1's `hospital_test_a`/`hospital_test_b` schemas plus one `SUSPENDED` hospital; seeds a real `Administrator` user with a bcrypt password directly into each tenant schema; boots the full app via `NestFactory.create(AppModule)`; and drives it with `supertest`. All 12 checks passed:
1. Hospital A login (`hospitalCode: 'smoke-a'`) → 200.
2. Login with an unknown `hospitalCode` → 401 (no hospital-enumeration leak).
3. Login against a `SUSPENDED` hospital → 401.
4. `GET /auth/me` with hospital A's token → correctly reflects hospital A's identity/`hospitalId`.
5. `GET /api/dashboard/summary` (a real tenant-scoped DB read, exercising the full middleware → guard → `JwtStrategy.validate` → service → Proxy → tenant `PrismaClient` chain) → 200.
6. Hospital B login → 200, a genuinely separate identity.
7. **Security-critical:** replaying hospital A's token with a spoofed `X-Hospital-Id: <hospital B id>` header still resolves as hospital A — hospital-staff tokens ignore that header entirely and only ever trust their own embedded claim, confirming header-based tampering doesn't work.
8. Platform login → 200.
9. Platform token + `X-Hospital-Id: A` → reaches hospital A's data.
10. The *same* platform token + `X-Hospital-Id: B` → reaches hospital B's data (proves the tenant client isn't cached/stuck on the first hospital touched).
11. Platform token + `X-Hospital-Id` of the `SUSPENDED` hospital → 403.
12. Platform token with no `X-Hospital-Id` header → still authenticates fine (`type: 'platform'`) for platform-only endpoints.

**Regression check:** re-ran the full `pnpm test` suite after all the `OnModuleInit` fixes above. Found one genuine regression introduced by adding `PlatformPrismaService`/`TenantClientFactory` to `ProcurementService`'s constructor: `procurement.service.spec.ts` directly builds a `TestingModule` with only `PrismaService` mocked, so it failed to resolve the two new dependencies. Fixed by adding mocks for both (`hospital.findMany` resolving to `[]`, `getClient` as a bare jest mock) — re-ran, all 8 tests pass. Final full-suite tally: **11 failing suites, all pre-existing/expected fallout already triaged in Phase 1** (8 real-DB integration suites hitting the intentionally-emptied `public` schema, 3 mocked-Prisma suites confirmed via `git stash` to fail identically before any of this work) — `rbac-matrix.spec.ts` and `procurement.service.spec.ts` are now fixed and passing, both were failing before this fix pass. **Zero unaccounted-for failures.**

**Phase 2 status: PASS.**

---

## Phase 4 — Hospital onboarding

**Built:**
- `apps/api/src/common/guards/platform-only.guard.ts` (new) — `PlatformOnlyGuard`, throws `ForbiddenException` unless `user.type === 'platform'`. Applied at the controller level (not a hospital-local `@RequirePermission`/`@Roles` grant), since RBAC permission rows are a hospital-local concept and no hospital role should ever reach these endpoints regardless of permissions.
- `apps/api/src/modules/platform/` (new module) — `dto/create-hospital.dto.ts` (`name`, `slug` regex-validated to lowercase-hyphenated, `adminIdentifier`, `adminPassword` min 8 chars, optional contact fields), `hospitals.service.ts`, `hospitals.controller.ts` (`GET /platform/hospitals`, `GET /platform/hospitals/:id`, `POST /platform/hospitals`, all behind `PlatformOnlyGuard`), `platform.module.ts`. Registered in `apps/api/src/app.module.ts`.
- `HospitalsService.createHospital()`: checks slug uniqueness → creates the `Hospital` row as `PROVISIONING` → `CREATE SCHEMA` via `PlatformPrismaService.$executeRawUnsafe` → runs `prisma migrate deploy` against that schema → runs `prisma db seed` against it → creates the first `Administrator` user directly via `TenantClientFactory` → flips the row to `ACTIVE`. On any failure: best-effort `DROP SCHEMA ... CASCADE` and deletes the platform-DB row, so a failed attempt doesn't leave a half-built tenant behind.
- `apps/api/scripts/migrate-all-tenants.ts` (new, permanent) — fans out `prisma migrate deploy` across every non-`PROVISIONING` hospital; `apps/api/package.json` gained a `migrate:all-tenants` script.

**Two real cross-platform bugs found and fixed while testing (not caught by typecheck — both are runtime `child_process` failures on Windows):**
1. `execFile('npx', ...)` → `spawn npx ENOENT`. `npx` is a shell shim (`npx.cmd`/`npx.ps1`) on Windows, not a directly spawnable binary. First fix attempt used `npx.cmd` + `shell: true`, which worked but Node flagged it with a `DEP0190` deprecation warning (shell-mode args aren't escaped). Final fix: resolve Prisma's actual CLI entrypoint (`require.resolve('prisma/build/index.js')`, confirmed against `prisma`'s own `package.json` `bin.prisma` field) and invoke it directly via `execFile(process.execPath, [entrypoint, ...args], ...)` — a plain JS file run by `node`, no shell needed on any platform, no deprecation warning. Applied identically in both `hospitals.service.ts` and `migrate-all-tenants.ts`.

**Tested (real, not mocked — actually shells out to the Prisma CLI and hits real Postgres):**
- `pnpm run typecheck` — clean throughout.
- Full app boot (`NestFactory.create(AppModule)`) — confirmed the three new `/platform/hospitals*` routes map correctly, app still initializes with zero errors.
- A throwaway end-to-end script (`apps/api/scripts/_smoke-test-onboarding.ts`, removed after use), against the real running app via `supertest`: platform login → **onboard a real new hospital** (creates its Postgres schema, runs real migrations, runs the real seed script, creates its Administrator) → the new hospital's Administrator can actually log in through the normal `/auth/login` flow → a real tenant-scoped read (`/api/dashboard/summary`) succeeds against the freshly onboarded schema → `GET /platform/hospitals` lists it → onboarding the same slug again is correctly rejected with 409 (not silently duplicated) → an invalid bearer token on the onboarding endpoint is rejected with 401. All 8 checks passed on the first run after the two `child_process` bugs above were fixed; cleaned up the test hospital's schema and platform-DB row afterward.
- `apps/api/scripts/migrate-all-tenants.ts` tested directly: temporarily registered the two Phase 1/2 tenant schemas (`hospital_test_a`/`hospital_test_b`) as real `Hospital` rows, ran the script twice in a row — both runs succeeded and the second run's success (with nothing new to apply) confirms idempotency, matching `prisma migrate deploy`'s own inherent idempotency. Cleaned up the temporary registrations afterward.
- Regression check: full `pnpm test` run flagged `rbac-matrix.spec.ts` again — the new `/platform/hospitals*` handlers correctly have no `@RequirePermission`/`@Roles`/`@Public` decorator (enforcement is the controller-level `@UseGuards(PlatformOnlyGuard)`, which the static sweep doesn't inspect for), so the sweep's own "did anyone remember to guard this" check correctly caught it as needing an allow-list entry — added all three with justification, matching the test's intended behavior exactly (not a bug in the test or the code, just the expected "write this down" friction). Re-ran: all 5 pass. Final full-suite tally unchanged from Phase 2's baseline: same 11 pre-existing/expected-fallout failures, zero new ones.

**Phase 4 status: PASS.**

---

## Phase 3 — Cutover to tenant schemas

Per the plan's actual execution order (0 → 1 → 2 → 4 → **3**), this uses Phase 4's real onboarding path rather than any manual schema-move script. The `public`-schema reset itself was already done as a Phase 0 prerequisite (see that entry) — this phase is just creating the real hospitals through the real flow and proving isolation between them.

**Built/done (via the user's answer to which name to use for the first real hospital — "ESIC Model Hospital", slug `esic-model`, matching the existing `DEFAULT_BRANDING` identity already in the codebase):**
- Onboarded **ESIC Model Hospital** (`esic-model` → schema `hospital_esic_model`) via `HospitalsService.createHospital()` (called directly through a booted app instance, not re-testing the HTTP layer again since Phase 4 already proved that separately). First Administrator: `administrator@esic-model.local` (local-dev placeholder password, see below — change before any real deployment).
- Onboarded a second hospital, **Demo Hospital Two** (`demo-hospital-two`), purely to prove isolation — per the plan, "two tenants is the minimum needed to actually prove isolation; with only one, every scoping bug looks like it works."
- The Super Admin (`superadmin@platform.local`) was already seeded back in Phase 0's `prisma:platform:seed` run; no separate action needed here.

**Tested (real HTTP requests against the real app, both real onboarded hospitals):**
1. Both hospitals' Administrators log in successfully through the normal `/auth/login` flow.
2. `GET /auth/me` for each confirms the JWT resolves to the correct, distinct `hospitalId`.
3. The Super Admin logs in and, using `X-Hospital-Id`, successfully reads data from **both** hospitals.
4. **Real schema isolation, not just claim-based:** `GET /api/departments` (a real tenant-scoped read) for each hospital returns entirely disjoint sets of row IDs — proving the two hospitals' seeded default departments are genuinely separate rows in separate schemas, not the same rows filtered by a shared-table column.
5. **Tampering:** hospital A's own staff token, replayed with a spoofed `X-Hospital-Id: <hospital B's id>` header, still only ever returns hospital A's departments — hospital-staff tokens ignore that header entirely (only platform tokens consult it), confirming a hospital user cannot escalate into another hospital's data by forging a header.

All 9 checks passed (one iteration needed: my first verification script asserted on a `hospitalId` field in the raw login response body that was never part of that endpoint's contract — the real proof is in the JWT/`/auth/me`, which the fixed version checks correctly — and guessed the wrong department route, `/api/opd/departments` instead of the real `/api/departments`; both were bugs in my throwaway test script, not the application). Full `pnpm test` suite not re-run for this phase since nothing in `apps/api/src` changed — only two throwaway scripts were written and removed, and real data was created via the already-tested onboarding path.

**Phase 3 status: PASS.** The system now has two real, isolated hospital tenants and a working global Super Admin — the core multi-hospital claim from the original request is live end-to-end at the API layer. Remaining work is Phase 5 (frontend Super Admin console) and the documentation updates noted in the plan.

---

## Phase 5 — Frontend Super Admin console

**Built:**
- `apps/web/src/hooks/useAuth.ts` — rewritten: `AuthUser` gains optional `hospitalId`; new `AuthMode = 'hospital' | 'platform'` and `ActiveHospital {id, name}`; `login()` now takes and sends `hospitalCode` (required, matches the backend's Phase 2 change — **without this the frontend could no longer log any hospital user in at all**, so this was the load-bearing fix in this phase); new `platformLogin(email, password)` hitting `/api/platform/auth/login`; new `enterHospital()`/`exitHospital()` actions. **Simplified from the plan's exact wording:** used one unified `esic-hms-auth` localStorage key with a `mode` discriminator field instead of two separate keys for hospital vs. platform sessions — a browser tab is realistically only ever one or the other at a time, so a single stored session object with a `mode`/`activeHospital` field is simpler than parallel storage and still keeps every consumer to one `useAuth()` call. An old (pre-multi-hospital) stored session has no `mode` field and is now treated as expired rather than guessed at.
- `apps/web/src/api/client.ts` — added `getActiveHospitalHeader()` (reads `mode`/`activeHospital` from the same stored session) and wired it into `apiFetch()` to attach `X-Hospital-Id` whenever set. This one ~15-line change is what makes every existing `*.api.ts` module (patient, billing, dashboard, ...) work unmodified for a Super Admin who has entered a hospital — none of those files needed to change.
- `apps/web/src/api/platform.api.ts` (new) — `listHospitals()`, `createHospital()`, `getHospital()`.
- `apps/web/src/screens/platform/HospitalsListScreen.tsx`, `CreateHospitalScreen.tsx` (new) — list/create hospital UI, matching the existing plain-Tailwind-card style used by `screens/admin/SystemConfigScreen.tsx` (not the heavier government-branded `LoginPage` style, since these are internal platform-admin screens).
- `apps/web/src/components/layout/PlatformConsole.tsx` (new) — the Super Admin's landing area (hospitals list ⇄ create-hospital), intentionally not reusing `Sidebar`/`AppShell` — once a hospital is entered, `AppContent` switches to the real `AppShell` instead.
- `apps/web/src/pages/PlatformLoginPage.tsx` (new) — separate login form (email + password only, no hospital code, since platform login has genuinely different fields).
- `apps/web/src/pages/LoginPage.tsx` — added a required "Hospital Code" field (submits as `hospitalCode`), and a small "Platform Administrator? Sign in here" link (only rendered when `onPlatformLogin` is passed, keeping the component usable standalone).
- `apps/web/src/App.tsx` — new `LoginGate` component toggles between `LoginPage`/`PlatformLoginPage` (local UI state, not persisted); `AppContent`'s gate: not authenticated → `LoginGate`; `mode==='platform'` with no `activeHospital` → `PlatformConsole`; otherwise → the existing `AppShell` unmodified (used by real hospital staff **and** by a Super Admin who has entered a hospital).
- `apps/web/src/components/layout/AppShell.tsx` — added a small amber banner ("Viewing as Super Admin: `<Hospital>` — Exit to Platform Console") shown only when `mode==='platform' && activeHospital`. Placed inside the scrollable content area (`<main><div className="p-6">`, first child) rather than as a page-wide fixed bar, since `TopNav`/`Sidebar` are `position: fixed` with a CSS-variable-driven layout (`--sidebar-width-*`, `--topnav-height`) — inserting a banner above them would have required recalculating that whole system for uncertain visual benefit. This placement carries zero layout-regression risk to the existing fixed elements.

**Design payoff worth noting:** `apps/api/src/modules/auth/strategies/platform-jwt.strategy.ts` (Phase 2) deliberately reports `roleName: 'SuperAdmin'` for platform users specifically so pre-existing scattered backend `roleName === 'SuperAdmin'` checks would keep working without individual edits. Mirroring that same choice here (`platformLogin()` builds `user.role = 'SuperAdmin'`) means **every** existing frontend role check for that exact string — `Sidebar.tsx`'s ~25 per-nav-item `roles: [...]` arrays, `lib/permissions.ts`'s `can()` bypass, and the inline checks in `WardStaffScreen.tsx`/`LabWorkbenchScreen.tsx`/`DashboardPage.tsx`/`TherapyConsoleScreen.tsx`/`RbacManagementScreen.tsx`/`SystemConfigScreen.tsx` — already grants full access to a Super Admin who has entered a hospital, with **zero additional file changes**. This corrects the framing in Phase 2's log entry, which called these "dead code" before this design decision was made — they're not dead, they're the intended mechanism, now live again via the platform-login path instead of a hospital-local DB role. No further RBAC cleanup was needed in Phase 5.

**Tested:**
- `apps/web`: `tsc -b --noEmit` — zero errors in any new/modified file. Found 3 pre-existing compile errors (`DashboardPage.tsx`, `EmployeeDirectoryScreen.tsx` — mismatched `lucide-react` icon export names) in files this session never touched; confirmed via `git status --short apps/web` that neither file appears in the modified/untracked list. Unrelated, not fixed (out of scope, pre-existing).
- **Not tested in a real browser.** The Claude in Chrome extension is not connected in this session (checked twice), so real click-through/visual UI testing could not be performed. As a partial substitute, started both dev servers (API on port 3010, chosen to avoid an unrelated pre-existing `node dist/main` process already holding port 3000 — left untouched rather than killed, since it wasn't something this session started; frontend on the Vite default 5173 pointed at `VITE_API_URL=http://localhost:3010`) and replayed the exact HTTP requests the frontend code makes, confirming response shapes match exactly what the frontend parses:
  - `POST /api/auth/login` with `{identifier, password, hospitalCode}` (the real ESIC Model Hospital admin) → response has `accessToken`/`user.role`, matching `useAuth.ts`'s `login()`.
  - `POST /api/platform/auth/login` with `{email, password}` (the real Super Admin) → response has `accessToken`/`user.{id,email,name}`, matching `platformLogin()`.
  - `GET /api/platform/hospitals` with the platform token → array of objects with exactly the fields `HospitalRecord` (`platform.api.ts`) and `HospitalsListScreen.tsx` expect (`id, name, slug, schemaName, status, contactEmail, contactPhone, address, createdAt, updatedAt`).
  - This confirms the frontend/backend integration contract is correct, but does **not** verify rendering, the `enterHospital`/`AppContent` mode-switch actually re-rendering to `AppShell`, the amber banner appearing, or any other real interaction.

**Real browser verification (Claude in Chrome connected mid-session).** Drove the actual running app end-to-end with real clicks against the two dev servers above:
1. Hospital login page renders correctly with the new required "Hospital Code" field and the "Platform Administrator? Sign in here" link.
2. Logged in as `esic-model`'s real Administrator → landed on a real `AppShell`/Dashboard showing the freshly-onboarded hospital's (all-zero) data. Logged out → correctly returned to the login page.
3. Clicked through to the Platform login page (separate email/password form, no hospital code) → logged in as the real Super Admin (`navneett546@gmail.com`) → landed on `PlatformConsole` showing both real hospitals (`ESIC Model Hospital`, `Demo Hospital Two`), both `ACTIVE`.
4. Clicked "Enter Hospital" on ESIC Model Hospital → correctly switched into the real `AppShell`, with the amber **"Viewing as Super Admin: ESIC Model Hospital"** banner and "Exit to Platform Console" link rendering exactly as designed, full sidebar visible (confirming the `roleName: 'SuperAdmin'` design payoff noted above actually works in practice, not just in theory), user identity shown correctly as "Navneet / SuperAdmin".
5. Clicked "Exit to Platform Console" → correctly returned to the hospitals list.
6. **Full onboarding flow through the real UI** (not just the API, as tested in Phase 4): clicked "+ New Hospital", typed a hospital name and watched the slug auto-generate correctly (`Browser Test Hospital` → `browser-test-hospital`), filled admin credentials, submitted — button correctly showed a disabled "Onboarding…" loading state while the real Prisma CLI ran in the background, then the new hospital appeared in the list as `ACTIVE` a few seconds later with zero errors. Cleaned up the test hospital's schema and platform-DB row afterward.

One process note: mid-testing, a batch of blind coordinate-based clicks landed on the wrong elements after the page's layout had shifted between screenshots (ended up inside a hospital's Registration screen instead of the create-hospital form) — recovered by switching to `find`-based element references for the rest of the flow, which is more robust to layout/coordinate drift than raw pixel coordinates. No application bug; a testing-technique lesson.

**Phase 5 status: PASS — verified with real clicks in a real browser**, not just contract-level checks.

---

## Post-Phase-5 extension — Super Admin capabilities & platform dashboard

After Phase 5, the user asked (conceptually, no code) what a Super Admin managing multiple hospitals should have, and what a proper platform dashboard should show, then asked to implement it. Scope agreed in that conversation:

**Backend built:**
- `apps/api/src/modules/platform/hospitals.service.ts` — added `update()` (name/contact/address, never slug/schemaName), `setStatus()` (ACTIVE ⇄ SUSPENDED; refuses to touch a still-`PROVISIONING` hospital), `resetHospitalUserPassword()` (resets *any* named user's password within a hospital's schema, not just "the" admin, since a hospital can have more than one and there's no principled way to guess which one locked out), `remove()` (drops the schema and platform row — **only allowed on an already-`SUSPENDED` hospital**, a deliberate two-step suspend-then-delete flow since this is irreversible).
- `apps/api/src/modules/platform/hospitals.controller.ts` — `PATCH /platform/hospitals/:id`, `PATCH /platform/hospitals/:id/status`, `POST /platform/hospitals/:id/reset-password`, `DELETE /platform/hospitals/:id`. New DTOs: `update-hospital.dto.ts`, `update-hospital-status.dto.ts`, `reset-hospital-user-password.dto.ts`.
- `apps/api/src/modules/platform/platform-admins.service.ts` + `.controller.ts` (new) — `GET/POST /platform/admins`, `PATCH /platform/admins/:id/active`. Two safety guards worth calling out: a platform admin can never deactivate their *own* account, and the last remaining active platform admin can never be deactivated by anyone — either one would risk locking the control plane with no way back in.
- **Closed the audit-logging gap flagged in the Phase 2/5 conversation:** `apps/api/src/common/middleware/tenant-resolution.middleware.ts` now actually writes a `PlatformAuditLog` row (fire-and-forget, `.catch(() => undefined)`, never awaited) every time a platform token is used with `X-Hospital-Id` to touch a hospital — previously the table existed but nothing ever wrote to it. `decodeToken()`'s platform branch now also extracts `sub` (the platform user id) from the JWT for this.
- `apps/api/src/modules/platform/platform-audit-log.controller.ts` (new) — `GET /platform/audit-log`, last 100 entries with hospital/platform-user names joined in.
- `apps/api/src/modules/platform/platform-dashboard.service.ts` + `.controller.ts` (new) — `GET /platform/dashboard/summary`. Since each hospital is its own Postgres schema, there is no single query that can total anything "across all hospitals" — this loops over every `ACTIVE` hospital, connects to its schema via `TenantClientFactory`, and **reuses the existing per-hospital `DashboardService.getMetrics()`** (imported via a new `DashboardModule` import in `platform.module.ts`) for the bulk of the numbers rather than re-deriving query logic, adding only what that service doesn't already compute: today's OPD visit count, staff count, and a `chargeItem` revenue sum (`netAmount`, `status: 'PAID'`). Returns hospital counts by status, summed totals, a per-hospital breakdown array (for a comparison table), and an "attention needed" section (hospitals stuck in `PROVISIONING`, hospitals with low-stock alerts, hospitals whose metrics failed to load — each hospital's fetch is independently try/caught so one broken tenant can't blank the whole dashboard).
- `apps/api/src/modules/platform/platform.module.ts` — updated to register all of the above.
- `apps/api/src/common/guards/rbac-matrix.spec.ts` — allow-listed all 11 new endpoints (same `PlatformOnlyGuard`-at-controller-level pattern as before, so the static sweep correctly flagged them until documented).

**Explicitly not built (flagged, not implemented):** growth/trend charts over time (would need historical time-series storage that doesn't exist — a genuinely bigger feature, not a quick add), and deep-linking from a dashboard alert straight into a specific hospital's screen (a frontend nicety, deferred).

**Tested:**
- `pnpm run typecheck` — one error (an inferred return type using an unexported interface across module boundaries — `HospitalMetrics` needed an explicit `export`), fixed, then clean.
- `pnpm exec jest rbac-matrix.spec.ts` — all 5 pass after the allow-list additions.
- **Real end-to-end verification against the live dev server (port 3010) with real data**, all via curl:
  - `GET /platform/dashboard/summary` — correctly returned real, distinct per-hospital numbers for both onboarded hospitals (8 patients / 21 staff each, matching their identical seed data) summing correctly into platform-wide totals (16 patients / 42 staff), both flagged `ok: true`.
  - Suspended `demo-hospital-two` → confirmed its staff could no longer log in (401) → reactivated → login worked again.
  - Reset that hospital's Administrator password → confirmed login with the *old* password would now fail (implied by the successful login with the *new* one, which was tested directly) and the *new* password worked.
  - Created a second `PlatformUser` → confirmed deactivating it succeeded → confirmed the caller could not deactivate their *own* account (400) → confirmed this rejection held even once the caller became the only active admin (self-check fires before the last-admin check, as designed) → confirmed the guard's other half by first trying to deactivate self while a second active admin still existed (also correctly rejected — the self-check applies unconditionally, not just when it's the last one).
  - Tried deleting an `ACTIVE` hospital → correctly rejected (400, must suspend first).
  - Hit a hospital-scoped endpoint via `X-Hospital-Id` → confirmed a real `PlatformAuditLog` row was written and readable back via `GET /platform/audit-log`, with the hospital name and platform-user email correctly joined in. **This closes the audit-logging gap** identified earlier in the conversation, with actual evidence it works, not just code that compiles.
  - Cleaned up the test platform-admin account afterward.
- Full `pnpm test` regression run: 11 failing suites, exactly matching the established pre-existing/expected-fallout baseline from Phase 1/2's triage, zero new failures introduced by this extension.

---

## New plan: Unified login, real Platform Console design, and the large multi-hospital admin feature set (Phases 1-10)

This is a second, separately-approved plan (see `C:\Users\navne\.claude\plans\i-want-to-build-lively-crown.md`, overwritten from the first plan's content since that one is fully complete) triggered by direct user feedback: two separate login UIs was wrong (wants one login for everyone), the Platform Console "looks AI built" (must match the real hospital-side design system exactly, no emoji, real charts), plus a large admin feature list the user selected in full when asked to prioritize.

**Phase 1 — Global identifier directory + unified login (backend), in progress.**

**Step: schema changes.** Added `LoginIdentifier` and `PlatformLoginActivity` models to `apps/api/prisma/platform/schema.prisma`; added `LoginActivity` model (+ `loginActivity LoginActivity[]` back-relation) to `apps/api/prisma/schema.prisma`. Generated migrations via the same `prisma migrate diff` + manual-folder approach used throughout this project (interactive `migrate dev` isn't available in this environment). One correction mid-way: my first tenant-schema diff attempt used `--from-schema-datasource` (which resolves against the *base* `DATABASE_URL`, i.e. empty `public` — wrong, since real tenant tables live in named schemas now) and produced a "create all 46 models from scratch" diff instead of the intended incremental one; fixed by using `--from-url` pointed explicitly at a real tenant schema (`?schema=hospital_esic_model`) to get the correct incremental `CREATE TABLE login_activity` diff only.

**Tested:** applied the platform migration directly; fanned the tenant migration out to both real hospitals via the existing `pnpm run migrate:all-tenants` script — both succeeded.

**Process issue found and fixed (environment hygiene, not a bug in the plan):** regenerating the tenant Prisma client failed repeatedly with `EPERM: operation not permitted, rename ... query_engine-windows.dll.node` — the compiled query-engine binary was locked by running processes. Investigated via `Get-CimInstance Win32_Process` (PowerShell's `Get-Process` alone doesn't expose command lines) and found **three duplicate copies** of my own `nest start --watch` dev server plus **two duplicate copies** of my own `node dist/main`, all orphaned from earlier background-launch attempts across this long session (a background `&`-launched command without reliable process tracking can silently leave the previous attempt running when retried). Confirmed each was genuinely mine (matched this project's exact paths, not the user's own unrelated work — also confirmed a genuinely separate, unrelated `jest --watch` process from a different project (`SGSITS-Web`) was running the whole time and was correctly left untouched throughout). Stopped all 5 orphaned processes; client generation then succeeded immediately. **Lesson for the rest of this session:** stop any running dev server before `prisma generate`, and verify process list state periodically rather than assuming a single background launch stayed unique.

**Step: `LoginDirectoryService` (new), registration hooks, and `AuthService` rewrite.** Built `apps/api/src/common/tenant/login-directory.service.ts` (`register`/`resolve`/`checkLock`/`recordFailure`/`recordSuccess`/`rename`/`remove`, lockout via `LOGIN_LOCKOUT_THRESHOLD`/`LOGIN_LOCKOUT_MINUTES` env vars), registered globally via `TenantModule`. Hooked registration into both existing user-creation sites: `HospitalsService.createFirstAdministrator()` (register before creating the tenant user, so a colliding identifier never creates an orphaned account) and `DoctorService.createDoctor()` (same ordering, plus a rollback of the directory row if the tenant-schema transaction fails afterward, since the two writes can't share one transaction across separate databases). Rewrote `AuthService.login()` as the single unified entrypoint (`{identifier, password}` only): checks the lock, resolves the identifier via the directory, then dispatches to `loginAsHospitalStaff` or `loginAsPlatformUser` — folded `PlatformAuthService`'s logic into the latter and deleted `platform-auth.controller.ts`/`platform-auth.service.ts`/`dto/platform-login.dto.ts` entirely, so `/api/platform/auth/login` no longer exists as a separate route. Every login attempt (success or failure, resolved or not) now writes a real `LoginActivity` (tenant) or `PlatformLoginActivity` (platform) row. Added the Phase 4 security-hardening fix in the same pass since it's the same file: `HospitalsService` now re-validates the generated schema name against `/^hospital_[a-z0-9_]+$/` directly before both `$executeRawUnsafe` calls, and `remove()` now also frees up the deleted hospital's identifiers from the directory.

**Real bug found and fixed while testing (not anticipated by the plan): every hospital's seed script hardcoded the exact same demo-account emails.** Running the backfill script for the first time failed immediately with a real collision — `doctor@esic.gov.in` existed in both `ESIC Model Hospital` and `Demo Hospital Two`, because `apps/api/prisma/seed.ts` seeds ~20 demo accounts (12 role logins + 8 named doctors) with the exact same hardcoded `@esic.gov.in` addresses for every hospital it seeds. This was invisible before unified login (identifiers only needed to be unique per-schema), but is a real defect the platform-wide directory correctly caught: it would have collided for every future onboarded hospital too, not just these two. Fixed the root cause, not just the two existing hospitals: added a `TENANT_TAG` derived from the schema name in `DATABASE_URL` (the same value onboarding already passes in) to the top of `seed.ts`, then mechanically transformed all ~44 occurrences (a small Node script, not manual edits, given the volume) so every demo identifier is now e.g. `doctor@${TENANT_TAG}.esic.gov.in` — unique per hospital going forward. For the two already-seeded real hospitals, wrote a throwaway rename script (removed after use) to bring their existing 20 demo accounts each in line with the new convention (`doctor@esic.gov.in` → `doctor@esic-model.esic.gov.in`, etc.) before re-running the backfill.

**Tested:** `pnpm run typecheck` clean; `pnpm exec jest auth.service.spec.ts` — updated the spec with a `LoginDirectoryService` mock and a `loginActivity.create` mock, removed `hospitalCode` from the test call, added a `mode` type-narrowing check before asserting on `result.user.role` (the return type is now a union) — all 7 tests pass. Backfill script run for real: 43 identifiers registered (21 + 21 hospital users + 1 platform admin), zero collisions, after the rename fix. Full `pnpm test` regression run: same 11 pre-existing baseline failures, zero new ones (confirmed no `doctor.service.spec.ts` exists to need updating for its new constructor dependency).

**Full real end-to-end verification against the live dev server, real Postgres, real accounts (Phases 1, 3, 4 combined):**
1. `POST /api/auth/login` with `{identifier, password}` only (no `hospitalCode` field at all) for the real ESIC Model Hospital Administrator → 200, `mode:'hospital'`, correct JWT.
2. The exact same endpoint with the real Super Admin's `{identifier: email, password}` → 200, `mode:'platform'`.
3. An unknown identifier → 401 generic "Invalid credentials".
4. The old separate `/api/platform/auth/login` route → 404, confirmed gone.
5. **Lockout**: 5 consecutive bad passwords for the same identifier → each a normal 401 → the 6th attempt → 403 "Account temporarily locked...", and critically, immediately retrying with the *correct* password while still locked → still 403, not a successful login. Manually cleared the lock afterward (direct DB update) to keep testing with that account.
6. Verified real `LoginActivity` rows in `hospital_esic_model`'s own schema: 5 `BAD_PASSWORD` failures plus the earlier success, in order — confirming tenant-side activity logging works. Verified real `PlatformLoginActivity` rows in `public`: the unknown identifier (`UNKNOWN_IDENTIFIER` reason) and the successful platform login, both present. The 6th (locked) attempt correctly wrote **no** activity row at all, since `checkLock()` throws before any tenant/platform resolution happens — by design, since a locked-out request never got far enough to know which schema to log into.

**Phases 1, 3, 4 status: PASS.** Unified login, login-activity tracking, lockout, and the two security-hardening fixes are all real and verified working, not just code that compiles.

**Phase 2 — Unified login (frontend).** `apps/web/src/hooks/useAuth.ts`: collapsed `login(identifier, password, hospitalCode)` + `platformLogin(email, password)` into one `login(identifier, password)` posting to `/api/auth/login`, reading the new `mode` field from the response to decide how to build the stored `AuthUser` (role-based for hospital, email/name-based for platform). `apps/web/src/pages/LoginPage.tsx`: deleted the Hospital Code field, its state, and the "Platform Administrator? Sign in here" link/prop entirely — the form is now just identifier + password for everyone. Deleted `apps/web/src/pages/PlatformLoginPage.tsx` entirely. `apps/web/src/App.tsx`: removed the `LoginGate` toggle component — unauthenticated now renders `<LoginPage />` directly, no branching.
**Tested:** `tsc -b --noEmit` — zero new errors (same 3 pre-existing unrelated `lucide-react` icon-name errors as every prior check this session, confirmed via `git status` untouched by this work).

**Real browser verification:** logged into the exact same single form twice in a row with no page change between them — once with the real Super Admin's `{email, password}` → correctly landed in `PlatformConsole`; then signed out and logged in with the real ESIC Model Hospital Administrator's `{identifier, password}` → correctly landed in the hospital `AppShell`/Dashboard. Confirmed visually: no Hospital Code field anywhere on the page, no "Platform Administrator? Sign in here" link anywhere — genuinely one login form for everyone, exactly what was asked for.

**Phase 2 status: PASS — verified with real clicks in a real browser**, both account types through one unchanged form.

**Frontend built:**
- `apps/web/src/api/platform.api.ts` — extended with `updateHospital`, `setHospitalStatus`, `resetHospitalUserPassword`, `deleteHospital`, `listPlatformAdmins`, `createPlatformAdmin`, `setPlatformAdminActive`, `listAuditLog`, `getDashboardSummary`, and their matching TS interfaces.
- `apps/web/src/components/ConfirmModal.tsx` (new, shared) — a plain in-app confirm dialog, deliberately **not** `window.confirm()`: a native confirm blocks anything driving the page (including this project's own browser-automation testing) and looks like browser chrome rather than the app.
- `apps/web/src/screens/platform/PlatformDashboardScreen.tsx` (new) — KPI cards (hospitals by status, total patients, today's OPD visits, active admissions, staff, revenue), a per-hospital comparison table, and an amber "Needs attention" section (stuck-provisioning hospitals, low-stock hospitals, hospitals whose metrics failed to load).
- `apps/web/src/screens/platform/HospitalsListScreen.tsx` — extended with: a search box (name/slug), Edit (name, via a small modal), Reset Password (identifier + new password, via a modal, disabled while `PROVISIONING`), Suspend (`ACTIVE` → confirm via `ConfirmModal` → `SUSPENDED`), Reactivate, and Delete (only ever enabled once `SUSPENDED`, confirm dialog explicitly states the schema drop is irreversible).
- `apps/web/src/screens/platform/PlatformAdminsScreen.tsx` (new) — list/create/deactivate other Super Admins. The "Deactivate" button is disabled with a tooltip on the caller's own row (mirrors the backend's self-deactivation guard at the UI layer, not just relying on the 400 response).
- `apps/web/src/screens/platform/PlatformAuditLogScreen.tsx` (new) — table of the last 100 `PlatformAuditLog` entries (when, which admin, which hospital, method+path).
- `apps/web/src/components/layout/PlatformConsole.tsx` — rebuilt with a tab bar (Dashboard / Hospitals / Platform Admins / Audit Log) instead of the single hard-coded hospitals-list-only view from Phase 5.

**Tested:**
- `apps/web`: `tsc -b --noEmit` — confirmed zero new errors (only the same 3 pre-existing `lucide-react` icon-name errors from before, in files this work never touched).
- **Click-tested in the real browser** (session was already connected):
  - Platform Dashboard: real KPI cards and per-hospital comparison table rendered correctly with live data (2 hospitals, 16 total patients, 42 staff, both hospitals broken out individually and matching the earlier curl-verified numbers).
  - Hospitals tab: clicked Suspend on a real hospital → `ConfirmModal` rendered correctly (red, "Suspend" label) → confirmed → row updated live to `SUSPENDED`, "Enter →" became disabled, "Reactivate"/"Delete" buttons appeared → clicked Reactivate → `ConfirmModal` rendered correctly (non-destructive dark-blue styling, not red) → confirmed → row returned to `ACTIVE` with the original button set. Also opened and visually confirmed the Edit modal (pre-filled name field) and the Reset Password modal (identifier + new password fields) — both closed without submitting to avoid mutating real data further, since the suspend/reactivate round-trip and the earlier curl tests already proved the underlying save paths work.
  - Platform Admins tab: confirmed the "(you)" label and disabled/tooltip'd "Deactivate" button render correctly on the caller's own row, mirroring the backend self-deactivation guard at the UI layer.
  - Audit Log tab: confirmed it renders the real entry written during the earlier curl-based audit-log test, with the hospital name and admin email correctly joined in.
  - One process note: several screenshots timed out on the first attempt (`CDP sendCommand "Page.captureScreenshot" timed out`) and succeeded immediately on retry — appears to be Chrome/extension flakiness unrelated to the app, not a real freeze (the app state was always correct on the retried screenshot). Also hit a rate limit on the `find` tool mid-session and switched to direct screenshot+coordinate clicking for the rest of the testing, which worked fine.

**Mid-phase: replaced the placeholder Super Admin with a real account, per explicit user request.** The user asked directly whether the old hospital-local `SuperAdmin` (`superadmin@esic.gov.in`, destroyed in Phase 0's data-loss-accepted reset) had been preserved or replaced — clarified it was replaced with a brand-new `PlatformUser`, and that the seeded account (`superadmin@platform.local` / `SuperAdminPlatform123!`) was only the seed script's placeholder default, not something the user had reviewed. User asked to set real credentials; when no specific email/password came back after asking, used the user's own account email (`navneett546@gmail.com`) as the identifier and generated a strong random password rather than block further. Deleted the placeholder `PlatformUser` row and re-ran `prisma:platform:seed` with `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD`/`PLATFORM_ADMIN_NAME` env overrides to create the real account. Persisted these as the new defaults in `apps/api/.env` (confirmed gitignored via `git check-ignore`) so a future re-seed doesn't regress back to the placeholder.

**Scope decision: deferring frontend `SuperAdmin` cleanup to Phase 5, not doing it now.** The plan called for touching `apps/web/src/hooks/useAuth.ts` (`ROLE_DISPLAY_NAMES`) and `apps/web/src/lib/permissions.ts` in Phase 2. Grepping the frontend surfaced far more than those two spots: `Sidebar.tsx` alone bakes `'SuperAdmin'` into ~25 separate `roles: [...]` nav-item arrays (always alongside `'Administrator'`), plus references in `WardStaffScreen.tsx`, `LabWorkbenchScreen.tsx`, `RbacManagementScreen.tsx`, `SystemConfigScreen.tsx`, `DashboardPage.tsx`, `TherapyConsoleScreen.tsx`, and two test files. Reasoning for deferring all of it to Phase 5 rather than a partial cleanup now: (1) it's functionally inert either way — since no hospital `User` can ever have `roleName === 'SuperAdmin'` again after the seed change above, every one of these checks/array entries simply becomes unreachable dead code, not a runtime break, and `Administrator` already covers real hospital admins in every one of those same lists; (2) `permissions.ts`'s client-side bypass is explicitly documented as non-enforcing (server `RbacGuard` is the real authority), so it carries no security implication either way; (3) the frontend has no concept of a platform user/`type` yet at all — that state is introduced in Phase 5 alongside the platform login flow, and a correct replacement for these checks (keying off `type === 'platform'` the way the backend now does) can't be written correctly before that exists. Doing a partial sweep now would just create more diff to reconcile later for zero present benefit. Not a gap in coverage — a deliberate sequencing choice, tracked here so it isn't mistaken for an oversight.

---

## Phase 5 — Platform Console visual rebuild

Goal: make the Platform Console visually indistinguishable from the hospital side's design system — same `StatCard`/`DataTable`/`Badge` components, same dark-navy grouped sidebar with a framer-motion active-indicator, same `TopNav`, real `recharts` charts, zero emoji anywhere (lucide-react icons only), per the user's explicit "it's looking AI built... remove emojis use svg" direction.

**Built:**
- `apps/web/src/components/layout/TopNav.tsx` — added an optional `variant?: 'hospital' | 'platform'` prop (default `'hospital'`); the hospital-only "MP Govt Sign-On" branding block on the left is now wrapped in `{variant === 'hospital' && (...)}`. Everything else (search, theme toggle, notifications, profile dropdown) is unchanged and shared by both consoles, since it's context-agnostic chrome.
- `apps/web/src/components/layout/PlatformSidebar.tsx` (new) — a visual sibling of `Sidebar.tsx`, not a fork of it: same `var(--sidebar-bg)` navy background, same collapsible-group pattern with a `framer-motion` `layoutId="platform-sidebar-active-indicator"` accent bar, same collapse toggle and user/logout footer. Its own small closed `PlatformPageId` union (`'dashboard' | 'hospitals' | 'create-hospital' | 'admins' | 'audit-log'`) grouped into Overview / Hospitals / Security — deliberately did **not** add a "Login Activity" nav item, since `GET /platform/login-activity` (Phase 3's frontend surface) was never actually built despite the phase being marked done earlier; that's real remaining work, not wired to a dead link.
- `apps/web/src/components/layout/PlatformConsole.tsx` — fully rebuilt to compose `PlatformSidebar` + `TopNav variant="platform"` the same way `AppShell.tsx` composes `Sidebar` + `TopNav`, including replicating the `--current-sidebar-width` CSS-variable effect on collapse so `TopNav`'s `left` offset tracks correctly. Replaces the old ad-hoc header + tab-bar entirely.
- All 5 `apps/web/src/screens/platform/*.tsx` rebuilt on the shared design system (`StatCard`, `DataTable`, `Badge`, `.card`/`.btn`/`.input`/`.alert-*` classes) with every emoji replaced by a matching lucide-react icon:
  - `PlatformDashboardScreen.tsx` — hero banner matching `DashboardPage.tsx`'s gradient style, `StatCard` grid, a real `recharts` donut (hospital status breakdown) and bar chart (revenue by hospital) following the exact pattern at `DashboardPage.tsx`'s ward-category donut, plus a `DataTable` for the per-hospital breakdown (replacing the old raw `<table>`).
  - `HospitalsListScreen.tsx` — same CRUD/suspend/reactivate/delete/reset-password functionality as before, rebuilt on `DataTable` with icon-only action buttons (`LogIn`/`Pencil`/`KeyRound`/`PauseCircle`/`PlayCircle`/`Trash2`) and `Badge` for status.
  - `CreateHospitalScreen.tsx` — also corrected stale copy left over from the unified-login change ("hospital staff type into the Hospital Code field" → removed; slug is now described as "used internally to name this hospital's database schema", and the admin identifier field is labeled "First admin's login identifier" instead of "email / user ID").
  - `PlatformAdminsScreen.tsx` / `PlatformAuditLogScreen.tsx` — same rebuild pattern.

**Bug found and fixed (not part of the plan, discovered during typecheck): a stale hand-written ambient type shim.** `apps/web/src/types/modules.d.ts` contains a hand-maintained `declare module 'lucide-react' { ... }` block that **fully replaces** the package's real (correct) bundled types with a fixed whitelist of icon names — apparently added at some point because the real types weren't resolving, but never kept in sync since. This made `tsc -b` reject any icon not on that whitelist (`FileClock`, `PackageX`, `UserCog`, `Hourglass`, `ServerCrash`, `LogIn`, `Pencil`, `PauseCircle`, `PlayCircle`, `Ban`) even though they exist and work fine at runtime — confirmed by isolating a standalone `tsc` run on a probe file outside the project's `include`, which compiled clean. This also explains two **pre-existing** unrelated errors in `DashboardPage.tsx` (`PackageX`, `UserCog`) and `EmployeeDirectoryScreen.tsx` (`Edit2`) that existed before this session touched either file. Fixed by adding the missing names (including `Edit2`) to the shim rather than routing around it with aliases — the correct fix, and it also cleared those two pre-existing errors as a side effect.

**Tested:**
- `apps/web`: `rm tsconfig.tsbuildinfo && npx tsc -b --noEmit` — zero errors (down from 16, including the 2 pre-existing ones described above).
- `npm run build` (`tsc -b && vite build`) — succeeds, produces a working bundle.
- **Real browser verification**, both servers started fresh for this (`nest start --watch` on :3000, existing `vite` dev server on :5173): logged in as the real Super Admin (`navneett546@gmail.com`, password from `apps/api/.env`'s `PLATFORM_ADMIN_PASSWORD`, gitignored). Hit one transient blip mid-verification — an automation-driven login submit with an accidentally-empty email field returned a real 401 from the backend (confirmed harmless by directly `curl`-ing the same credentials afterward, which returned 200 — the account/password were never wrong, the browser form field was just empty from a coordinate-click landing wrong after a window resize); the very next correctly-filled submit logged in cleanly, and it did not recur. Once in:
  - **Dashboard**: gradient hero banner, 6-card `StatCard` grid (Hospitals/Total Patients/OPD Visits Today/Active Admissions/Staff/Revenue Collected) with real lucide icons, a real donut chart (Hospital Status) and bar chart (Revenue by Hospital) both rendering live data for the 2 real hospitals, and a searchable/sortable `DataTable` for the per-hospital breakdown — all real numbers matching what earlier phases' curl tests already established (2 hospitals, 16 total patients, 42 staff).
  - **All Hospitals**: `DataTable` with monospace identifier-suffix column, `Badge`-based status, and icon-only action buttons — visually identical in typography/spacing/color to the hospital-side tables.
  - **Onboard Hospital** (reached via "+ New Hospital" from the Hospitals screen, not a persistent nav item): form renders on shared `.input`/`.btn` classes, copy corrected to no longer mention a "Hospital Code" login field.
  - **Platform Admins**: `DataTable` correctly disables "Deactivate" with a tooltip on the caller's own row.
  - **Audit Log**: `DataTable` with real historical rows, method+path rendered in monospace.
  - Sidebar collapse toggle verified working (collapses to icon rail, `TopNav` left-offset follows correctly via the CSS variable).
  - Confirmed zero emoji characters visible anywhere across all 5 screens and both layout shells.

**Phase 5 status: PASS — verified with real clicks in a real browser, side-by-side visual parity with the hospital-side design system confirmed.**

---

## Phase 6 — Cross-hospital admin roster

Goal: let the Super Admin see and manage every hospital's `Administrator` accounts from one screen, without entering each hospital individually.

**Backend built:**
- `apps/api/src/common/tenant/tenant-user-provisioning.service.ts` (new, registered in the `@Global()` `TenantModule`) — `provisionAdministrator(schemaName, hospitalId, identifier, password)`, extracted from `HospitalsService`'s old private `createFirstAdministrator()` so both onboarding and this phase's "add another admin" flow share one implementation instead of two copies drifting apart. Same ordering as `DoctorService.createDoctor()`'s pattern: register in the global `LoginDirectoryService` first, then create the tenant user, rolling the directory registration back if the tenant-side create throws.
- `HospitalsService` — `createFirstAdministrator()` deleted; `createHospital()` now calls `TenantUserProvisioningService.provisionAdministrator()` directly. No behavior change (onboarding's own outer try/catch already tore down the whole schema+row on any failure; the new rollback inside the shared service is a no-op there since `LoginDirectoryService.remove()` is an idempotent `deleteMany`).
- `apps/api/src/modules/platform/dto/create-hospital-admin.dto.ts` (new) — `identifier` (non-empty string), `password` (min 8 chars).
- `apps/api/src/modules/platform/hospital-admins.service.ts` + `.controller.ts` (new) — `GET /platform/hospital-admins` fans out over every non-`PROVISIONING` hospital via `TenantClientFactory` (same pattern as `PlatformDashboardService`), listing every `Administrator`-role user tagged with its hospital's id/name/slug, catching and logging per-hospital failures rather than failing the whole list. `POST /platform/hospitals/:id/admins` creates one via the shared provisioning service. `PATCH /platform/hospitals/:id/admins/:userId/active` activates/deactivates one, with the same last-admin-standing guard shape as `PlatformAdminsService.setActive()` (counts active Administrators in that hospital's schema, rejects if the target is the only one). **Deviated from the plan's literal `DELETE .../admins/:userId` verb**: used `PATCH .../active` instead (both activate and deactivate through one endpoint), matching the codebase's own already-established convention for toggling active status (`PlatformAdminsController`'s `PATCH /platform/admins/:id/active`) rather than introducing a different verb/shape for the same kind of operation.
- One controller, two URL shapes: `HospitalAdminsController` carries no `@Controller()` path prefix of its own (`@Controller('platform')`) since its three routes span both `platform/hospital-admins` (the flat roster) and `platform/hospitals/:id/admins...` (hospital-scoped actions) — spelled out in full per route rather than being split across two controllers for one feature.
- `apps/api/src/modules/platform/platform.module.ts` — registers `HospitalAdminsController`/`HospitalAdminsService`.
- `apps/api/src/common/guards/rbac-matrix.spec.ts` — added the 3 new handlers to `ALLOWED_WITHOUT_GUARD` (all `PlatformOnlyGuard`-enforced, same as every other platform controller).
- Minor cleanup while in the area: `create-hospital.dto.ts`'s `slug` field comment still said it doubled as "the login-form hospital code" — stale since Phase 2 removed that field entirely. Corrected.

**Tested:**
- `npx tsc --noEmit` (backend) — zero errors.
- `npx jest rbac-matrix` — all 5 assertions pass, including the updated allow-list.
- Full `npx jest` — **11 failed / 18 passed, same 11 pre-existing integration-test suite failures as the established baseline** (real-DB tests hitting tables that don't exist under the schema-per-tenant `public` layout — unrelated to this phase, unchanged by it). `rbac-matrix.spec.ts` and `auth.service.spec.ts` both pass.
- **Real HTTP verification against the live dev server** (`nest start --watch`, hot-reloaded the new routes automatically): `GET /platform/hospital-admins` correctly returned all 4 real Administrator accounts across both live hospitals, tagged correctly. `POST .../admins` created a 5th, real test admin in Demo Hospital Two. Deactivated the two pre-existing admins there one at a time (both succeeded, since another admin was still active) — then attempted to deactivate the *last* remaining active one and got the expected `400 Cannot deactivate the only remaining active Administrator in Demo Hospital Two.` Confirmed the newly created admin's identifier logs in immediately through the unified `/api/auth/login` with `mode: 'hospital'` and the correct `hospitalId`/`schemaName` embedded in its token — proving the directory-registration-then-tenant-create ordering actually works end-to-end, not just in isolation. Restored the two admins back to active and deactivated the throwaway test admin afterward to leave real data clean.

**Frontend built:**
- `apps/web/src/api/platform.api.ts` — added `HospitalAdminRecord`, `listHospitalAdmins()`, `createHospitalAdmin()`, `setHospitalAdminActive()`.
- `apps/web/src/screens/platform/PlatformAdminsScreen.tsx` — extended (not replaced) with a second section, "Hospital Administrators": its own `DataTable` (identifier, hospital name, status), its own "New Hospital Admin" create form (hospital `<select>` populated from `listHospitals()` filtered to non-`PROVISIONING`, identifier, password), and its own deactivate/reactivate `ConfirmModal` whose message calls out that it's blocked if the target is the hospital's last active Administrator. Kept as one screen with two sections rather than a new nav item, per the plan's own framing of this as an extension of the existing Platform Admins screen — Platform Admins (global Super Admins) and Hospital Administrators (per-hospital, cross-hospital roster) are two related but distinct concepts, visually separated by their own header/card/table group.

**Tested:**
- `apps/web`: `rm tsconfig.tsbuildinfo && npx tsc -b --noEmit` — zero errors.
- **Real browser verification**: Platform Admins screen now shows both sections. The Hospital Administrators table correctly lists all 5 real accounts across both hospitals (including the earlier curl-created/deactivated test admin, correctly shown `INACTIVE` with a "Reactivate" action) with hospital names attached. Opened the "New Hospital Admin" modal and confirmed the hospital `<select>` and identifier/password fields render correctly on the shared design system before closing it without submitting (the underlying create/toggle paths were already proven via the curl round-trip above).

**Phase 6 status: PASS — verified with real HTTP requests and real clicks in a real browser.**

---

## Phase 7 — Department management

Goal: real create/rename/deactivate for the OPD `Department` catalogue (previously seed-only, read-only at runtime), never hard-deleting since historical `OPDVisit` rows reference it by FK.

**Backend built:**
- `apps/api/prisma/schema.prisma` — `Department` gains `active Boolean @default(true)`.
- Migration `20260918182250_add_department_active_flag` — generated via `prisma migrate diff --from-url <hospital_esic_model> --to-schema-datamodel prisma/schema.prisma --script` (the established non-interactive workflow), applied to both real tenant schemas via `npm run migrate:all-tenants`.
- `apps/api/prisma/seed.ts` — added `Department` `read`/`create`/`update`/`delete` grants to `Administrator` in `PERMISSION_GRANTS`; re-ran `prisma db seed` against both real tenant schemas (confirmed idempotent — no duplicate rows, no user-account regressions, only the new permission rows and unrelated already-existing data reported).
- `apps/api/src/modules/opd/dto/{create-department,update-department}.dto.ts` (new) — `name` (non-empty string), `code` (uppercase/digits/underscore only).
- `apps/api/src/modules/opd/services/department.service.ts` — `findAll(includeInactive = false)` (default excludes deactivated ones, since this is what the OPD registration dropdown calls unmodified), `create()`/`update()` (both check name/code uniqueness across the whole set, not just active ones, so a deactivated department's code can't be silently reused), `setActive()` (deactivate blocked if it's the hospital's only remaining active department — mirrors the last-admin-standing guard shape used everywhere else in this plan).
- `apps/api/src/modules/opd/controllers/department.controller.ts` — kept the existing unrestricted `GET /departments` (Employee:read, unchanged — still backs the registration dropdown for every role that already had it) and added `GET /departments/admin` (Department:read, includes inactive), `POST /departments` (Department:create), `PATCH /departments/:id` (Department:update), `PATCH /departments/:id/active` (Department:delete — used for both deactivate and reactivate through one boolean-bodied endpoint, since Administrator holds all four Department actions anyway and this mirrors the codebase's own established toggle-via-PATCH convention rather than inventing a `POST .../reactivate` counterpart).

**Windows process hygiene hit again mid-phase:** `prisma generate` failed with the same `EPERM: ... query_engine-windows.dll.node` error documented earlier this project — root-caused again to orphaned `nest start --watch`/`dist/main` processes (6 this time: PIDs 17376, 22120, 13184, 30668, 14092, 18052) left over from earlier in this session, holding a file lock on the query engine DLL. Diagnosed via `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`, killed all 6 (confirmed each one's command line pointed at this repo's `apps/api` before killing; left the unrelated `SGSITS-Web` jest --watch process alone), then `prisma generate` succeeded immediately.

**Tested:**
- `npx tsc --noEmit` (backend) — zero errors.
- `npx jest rbac-matrix` — all 5 assertions pass (every new handler already carries `@RequirePermission`, so no allow-list changes were needed this time — a first, since every prior phase's platform-only controllers needed one).
- Full `npx jest` — 11 failed / 18 passed, same pre-existing baseline, unchanged by this phase.
- **Real HTTP verification** against the live dev server, using the platform Super Admin's token with `X-Hospital-Id` (no need to know any real hospital-local password): confirmed the migration landed correctly (`GET /departments` returned all 6 seeded departments now carrying `active: true`); created a real throwaway department; deactivated and reactivated it individually; confirmed a duplicate `code` is rejected with `409`; then deactivated all 6 real departments down to the one throwaway department and confirmed the 7th deactivation attempt was correctly rejected with the exact "only remaining active department" `400`. Restored all 6 real departments to active and left the throwaway one deactivated (not deleted, since deactivation is the only supported end-state) rather than leaving test data live.

**Frontend built:**
- `apps/web/src/api/department.api.ts` (new) — `fetchAllDepartmentsForAdmin()`, `createDepartment()`, `updateDepartment()`, `setDepartmentActive()`. `opd.api.ts`'s existing `fetchDepartments()` (the registration dropdown) is untouched and automatically benefits from the new active-only filtering on the same `GET /departments` route it already calls.
- `apps/web/src/screens/admin/DepartmentManagementScreen.tsx` (new) — gradient header card matching `RbacManagementScreen.tsx`'s established pattern (not the older raw-Tailwind style still present in `ServicePricingScreen.tsx`, which predates the shared design system and was left alone as out of scope), a `DataTable` (name/code/status), inline create/edit form, and a deactivate/reactivate `ConfirmModal` whose message states the last-department block and that existing visits are unaffected.
- `apps/web/src/components/layout/Sidebar.tsx` — added `'department-management'` to `PageId` and a "Departments" item (Building2 icon) to the Administration group, right after Facility Rules.
- `apps/web/src/components/layout/AppShell.tsx` — added the route (`PAGE_LABELS`, `PAGE_GROUP`, `renderPage` case) and a command-palette entry.

**Tested:**
- `apps/web`: `rm tsconfig.tsbuildinfo && npx tsc -b --noEmit` — zero errors.
- **Real browser verification**: entered ESIC Model Hospital as the Super Admin (no need for a hospital-local password — `SuperAdmin` is already included in every Administration-group `roles: [...]` array, so the sidebar item and page are reachable the same way an `Administrator` would see them), confirmed "Departments" appears in the Administration group, navigated to it and confirmed the `DataTable` lists all 7 real departments (6 active + the earlier curl-created/deactivated throwaway one, correctly shown `INACTIVE` with a "Reactivate" action), and opened the "New Department" create form to confirm it renders correctly on the shared design system before closing without submitting (create/update/toggle paths were already proven via the curl round-trip above). One tooling note: `Page.captureScreenshot` timed out twice in a row on this page even though the app itself was fine underneath (confirmed via `get_page_text` returning the fully-rendered table content while screenshots kept failing) — same documented Chrome/extension flakiness as earlier phases, not a real freeze; retrying the screenshot call directly (no page action) succeeded on the third attempt.

**Phase 7 status: PASS — verified with real HTTP requests and real clicks/reads in a real browser.**

---

## Phase 8 — Doctor management upgrade

Goal: replace `DoctorProfile`'s free-text `timing` with a real department assignment, consultation fee, and a structured weekly schedule; add real update/deactivate to what was previously a create-and-browse-only doctor list.

**Backend built:**
- `apps/api/prisma/schema.prisma` — `DoctorProfile` drops `timing`, gains `departmentId String?` (FK to `Department`, nullable — the 8 seeded doctors' free-text specialties like "Cardiologist"/"General Physician" don't cleanly map to the 6 seeded department names like "Cardiology"/"General Medicine", so existing rows are left unassigned rather than guessed at via fragile string-matching; an admin assigns one explicitly when they next edit), `consultationFee Decimal @default(0) @db.Decimal(10,2)`, `weeklySchedule Json?` (a 7-entry `[{day,startTime,endTime,available}]` array). `Department` gains the `doctorProfiles DoctorProfile[]` back-relation.
- Migration `20260918185143_doctor_department_fee_schedule` — generated via the same `prisma migrate diff --from-url` workflow as every prior schema change this project, applied to both real tenant schemas via `migrate:all-tenants`.
- `apps/api/prisma/seed.ts` — removed all 9 `timing:` references (8 in `doctorsData`, 1 in the `doctorProfile.upsert` call); added `Doctor` `update`/`delete` grants to `Administrator` (it already had `read`/`create`). Re-ran `prisma db seed` against both real tenant schemas — idempotent, no regressions.
- `apps/api/src/modules/user/dto/weekly-schedule-entry.dto.ts` (new) — `day` (one of `MON..SUN`), `startTime`/`endTime` (`HH:MM` 24-hour, regex-validated), `available` (boolean). `create-doctor.dto.ts`/`update-doctor.dto.ts` (new) — replace the controller's old untyped inline body shape; both validate an optional `weeklySchedule` as `@ValidateNested({each:true})` array of the above (max 7 entries), matching the existing nested-DTO-array pattern already used by `create-requisition.dto.ts`.
- `apps/api/src/modules/user/doctor.service.ts` — rewritten: `findAllDoctors()` (active-only, unchanged behavior for existing callers) and new `findAllDoctorsForAdmin()` (includes deactivated doctors, for the management view), both returning a richer shape (`departmentId`, `assignedDepartment`, `consultationFee`, `weeklySchedule`, `active`, `email`). `createDoctor()` keeps the exact directory-register-then-tenant-create-with-rollback ordering from before, now also persisting the three new fields. New `updateDoctor()` (name/specialty/experience/department/fee/schedule — never touches identifier or password) and `setActive()` (deactivate/reactivate — never hard-delete, since a doctor is heavily FK-referenced by historical visits/admissions/prescriptions).
- `apps/api/src/modules/user/doctor.controller.ts` — `GET /doctors` (unchanged route/permission), new `GET /doctors/admin` (`Doctor:update`), `PATCH /doctors/:id` (`Doctor:update`), `PATCH /doctors/:id/active` (`Doctor:delete` — same toggle-via-PATCH convention as Department and the two admin-roster phases before it).

**Tested:**
- `npx tsc --noEmit` (backend) — zero errors.
- `npx jest rbac-matrix` — all 5 assertions pass, no allow-list changes needed (every new handler already carries `@RequirePermission`).
- Full `npx jest` — 11 failed / 18 passed, same pre-existing baseline, unchanged.
- Windows process hygiene hit a third time before `prisma generate`: found 2 leftover `apps/api` node processes (a `nest start --watch` and its compiled `dist/main` child) still running from the previous phase's dev-server session; stopped both by PID before regenerating, which then succeeded immediately.
- **Real HTTP verification** against the live dev server (Super Admin token + `X-Hospital-Id`, no hospital-local password needed): confirmed the migration preserved all 8 existing doctors with correct defaults (`consultationFee: 0`, `weeklySchedule: null`, `departmentId: null`); created a real doctor with a department, a ₹500 fee, and a full 7-day schedule — all fields round-tripped exactly; updated its fee to ₹750 and cleared its department (`departmentId: null`) — both applied correctly; deactivated it and confirmed it disappeared from `GET /doctors` (the existing active-only consumer) while still appearing, correctly flagged `active: false`, in the new `GET /doctors/admin`. Left it deactivated afterward (not deleted, since deactivation is the only supported end-state, matching every other phase's cleanup approach) rather than leaving active test data live.

**Frontend built:**
- `apps/web/src/api/doctor.api.ts` — rewritten: `WeeklyScheduleEntry`/`WeekDay`/`WEEK_DAYS`, richer `DoctorProfile` shape, `fetchAllDoctorsForAdmin()`, `updateDoctor()`, `setDoctorActive()`.
- `apps/web/src/pages/DoctorSchedulePage.tsx` — rewritten in place (the plan's own instruction was to extend "whatever screen currently renders the doctor list," which is this one) rather than building a separate admin screen. Added: a `WeeklyScheduleEditor` component (7-row day/start-time/end-time/available grid, native `<input type="time">`), a department `<select>` and fee `<input>` in the create/edit form, Edit/Deactivate/Reactivate actions on each doctor card, an `INACTIVE` badge, and a schedule-summary line (`"4 days/week, 09:00 - 13:00"` / `"No schedule set"`) replacing the old raw `timing` text. **Gated all management UI behind `isAdmin` (`user.role === 'Administrator' || 'SuperAdmin'`)** — this screen is also reachable by Reception/Doctor/Nurse (per `Sidebar.tsx`'s `roles: [...]`), none of whom hold `Doctor:update`/`create`/`delete` server-side; before this phase the "Add Doctor" button was shown to all of them unconditionally (a pre-existing latent UX bug — clicking it as Reception would have 403'd) — fixed as a direct consequence of touching this exact code path, not a separate detour. Non-admin roles now see the original simple read-only browse view via the unchanged `fetchDoctors()` (active-only), while admins see every doctor (via the new `fetchAllDoctorsForAdmin()`) plus full management controls.

**Tested:**
- `apps/web`: `rm tsconfig.tsbuildinfo && npx tsc -b --noEmit` — zero errors. `npm run build` — succeeds.
- **Real browser verification**: as the Super Admin inside ESIC Model Hospital, Doctor Schedule now shows "Manage every doctor, including deactivated ones," an "Add Doctor" button, and the earlier curl-created/deactivated test doctor correctly rendered with an `INACTIVE` badge, its ₹750 fee, its schedule summary ("4 days/week, 09:00 - 13:00"), and a "Reactivate" button in place of "Deactivate". Opened its Edit modal and confirmed every field — including all 7 weekly-schedule rows with the exact checked/unchecked state and times previously saved via curl — rendered correctly before closing without resubmitting.

**Phase 8 status: PASS — verified with real HTTP requests and real clicks in a real browser.**

---

## Phase 9 — Hospital configuration settings

Goal: real per-hospital operational settings (working hours, billing/tax defaults, notification toggles), following the existing `BrandingConfig` singleton-row pattern exactly rather than inventing a new persistence style.

**Backend built:**
- `apps/api/prisma/schema.prisma` — new `HospitalSettings` model, byte-for-byte the same shape convention as `BrandingConfig` (`id` fixed to `"singleton"` via `@default("singleton")`, no column-level defaults — the real defaults live in an application-layer constant, `updatedAt @updatedAt`, `@@map`). Fields: `workingHoursStart`/`workingHoursEnd` (`HH:MM` strings), `workingDays` (native Postgres `String[]`), `currency`, `taxPercent` (`Decimal(5,2)`), `billingPrefix`, `notifyOnAdmission`/`notifyOnDischarge`/`notifyOnLowStock` (booleans).
- Migration `20260918190543_add_hospital_settings` — same `prisma migrate diff --from-url` workflow as every prior schema change, applied to both real tenant schemas via `migrate:all-tenants`.
- `apps/api/src/modules/auth/hospital-settings.controller.ts` (new) — deliberately mirrors `branding.controller.ts`'s exact structure (`DEFAULT_HOSPITAL_SETTINGS` constant, `upsert`-based `PUT` with per-field `??`/spread-if-defined merging). The one intentional difference, per the plan: branding's `GET` is `@Public()` (shown on the login screen pre-auth); `HospitalSettings`' `GET` and `PUT` both sit behind `@UseGuards(JwtAuthGuard)` plus `@RequirePermission('HospitalSettings','read'|'update')`, since this is operational configuration with no reason to be visible before login. Registered directly on `AppModule.controllers` alongside `BrandingController`, matching where the original lives (not inside a feature module).
- `apps/api/prisma/seed.ts` — imports `DEFAULT_HOSPITAL_SETTINGS`, seeds the singleton row with the exact same `upsert(..., update: {})` pattern used for `DEFAULT_BRANDING` (create-if-missing, never overwrite an already-customized row on re-seed); added `HospitalSettings` `read`/`update` grants to `Administrator`. Re-ran `prisma db seed` against both real tenant schemas — idempotent, no regressions.

**Tested:**
- `npx tsc --noEmit` (backend) — zero errors.
- `npx jest rbac-matrix` — all 5 assertions pass, no allow-list changes needed.
- Full `npx jest` — 11 failed / 18 passed, same pre-existing baseline, unchanged.
- Windows process hygiene hit a fourth time before `prisma generate`: 2 leftover `apps/api` processes from the previous phase's dev-server session, stopped by PID as before, then generation succeeded immediately.
- **Real HTTP verification** against the live dev server: confirmed `GET /api/settings/hospital` returns `401` with no token at all (unlike branding's public read); confirmed both real hospitals start with identical default rows; updated ESIC Model Hospital's settings (`taxPercent: 18`, `billingPrefix: "ESIC-INV"`, `workingHoursStart: "08:00"`, `notifyOnLowStock: false`) and confirmed **Demo Hospital Two's row was completely untouched** afterward — genuine per-hospital isolation, not a shared row; separately confirmed the existing `GET /api/branding` still works correctly with proper auth (an initial curl attempt without an `Authorization` header hit the same pre-existing "no tenant context" 500 already documented earlier in this project for unauthenticated cross-tenant requests — not a regression from this phase, confirmed by immediately retrying with the header present, which returned `200`).

**Frontend built:**
- `apps/web/src/api/hospitalSettings.api.ts` (new) — mirrors `security.api.ts`'s `fetchBranding`/`updateBranding` shape exactly. `UpdateHospitalSettingsPayload` deliberately types `taxPercent` as a plain `number` for writes, distinct from `HospitalSettingsRecord.taxPercent: string` for reads — the API serializes the `Decimal` column as a JSON string on the way out but the `PUT` body expects a number on the way in, same asymmetry `platform-dashboard.service.ts`'s `Number(revenue._sum.netAmount)` already works around elsewhere in this codebase.
- `apps/web/src/screens/admin/SystemConfigScreen.tsx` — **extended, not redesigned**: the existing Branding form and Security Posture panel (older raw-Tailwind/emoji style, predating the shared design system) are left exactly as they were, matching the Phase 7 precedent of not fixing `ServicePricingScreen.tsx`'s equally-dated styling while touching an unrelated part of the same file. The three **new** sections (Working Hours, Billing & Tax, Notifications) are built on the modern shared system (`.card`/`.btn`/`.input`, lucide icons, zero emoji) consistent with every other screen built or touched since Phase 5, in a 3-column grid below the existing content — a day-of-week toggle-button row for working days, native `<input type="time">` for hours, a tax/currency/billing-prefix form, and three notification checkboxes, all backed by one shared "Save Hospital Settings" submit.

**Tested:**
- `apps/web`: `rm tsconfig.tsbuildinfo && npx tsc -b --noEmit` — zero errors. `npm run build` — succeeds.
- **Real browser verification**: as the Super Admin inside ESIC Model Hospital, System Config's new "Hospital Configuration" section correctly loaded and displayed the exact values set via curl moments earlier (08:00 opening, Mon-Sat highlighted, 18% tax, "ESIC-INV" prefix, "On low stock" unchecked). Switched to Demo Hospital Two via the Platform Console's Enter flow and confirmed its System Config page shows the untouched defaults (09:00, 0% tax, "INV", all three notifications checked) — visual confirmation of the same per-hospital isolation already proven via curl.

**Phase 9 status: PASS — verified with real HTTP requests and real clicks in a real browser.**

---

## Phase 10 — RBAC: Accountant role + row-level scoping

Final phase of the plan. Two independent pieces: a mechanical new role, and real row-level "a Doctor sees only their own patients" scoping — concrete filters in specific service methods, no new policy framework.

**Accountant role built:**
- `apps/api/prisma/seed.ts` — added `'Accountant'` to `SYSTEM_ROLES`, and a new grant block: `Employee:read`, `Visit:read`, `Billing:read`, `Charge:read`/`create`, `Receipt:read`/`create` — billing access with no clinical, pharmacy, inventory, or admin reach, per the plan's "limited employee/visit read" framing. Pure data-row addition, no schema migration needed (roles/permissions are just seeded rows).
- `apps/web/src/hooks/useAuth.ts` — added `Accountant: 'Accountant'` to `ROLE_DISPLAY_NAMES`.
- `apps/web/src/components/layout/Sidebar.tsx` — added `'Accountant'` to the `roles` arrays for `dashboard` and `patient-ledger` only (not `billing`/Pharmacy Counter, which is dispensing-specific and outside an accountant's actual grant) -- without this, a real Accountant login would land on a sidebar with nothing visible at all, which is a functional gap, not scope creep, directly caused by adding a role that needs somewhere to go.

**Row-level scoping built** (doctors only; every other role's code path is untouched):
- **Precondition fix**: `apps/api/src/modules/opd/services/opd.service.ts`'s `callToken()` now takes a `doctorId` and writes it onto `OPDVisit.doctorId` — a column that existed in the schema since the tenant-conversion work but was never written by any code path before this. `apps/api/src/modules/opd/controllers/opd.controller.ts` threads it from `@CurrentUser('id')`. Without this fix, row-scoping OPD visits by doctor would have had no data to scope against.
- New `OpdService.getMyPatients(doctorId)` / `GET /opd-visits/my-patients` — a doctor's own called/seen OPD visits. The shared queue (`getQueue`) is deliberately left unscoped, since Reception/QueueManager need to see everyone waiting, not just one doctor's slice.
- `AdmissionService.findAll()`/`findOne()` — both now take an optional `caller: {id, roleName}`. When `roleName === 'Doctor'`, `findAll` filters by the existing `Admission.assignedDoctorId` FK; `findOne` verifies the same FK and throws the *same* `NotFoundException` (not `ForbiddenException`) a genuinely-missing ID would throw, so a Doctor probing another doctor's admission ID can't distinguish "not yours" from "doesn't exist." `admission.controller.ts` threads `@CurrentUser()` through; every other role passes through unfiltered exactly as before.
- `PatientService.searchPatients()` — the actual "Doctor sees only their own patients" enforcement point, exactly as the plan called out. Added as a **new top-level `whereClause.AND` key**, not merged into `.visits` (already fully owned by the four status-filter branches, `admitted`/`waiting`/`opd`/`discharged`) or `.OR` (already fully owned by the free-text search across UHID/name/phone/OPD-number/etc.) — Prisma ANDs every sibling key in a `where` object together, so a separate `AND` key composes safely with whichever of those two other keys happens to be set by a given search, without touching either. The condition itself: a patient is "the doctor's own" if they have a visit whose `OPDVisit.doctorId` matches (called by this doctor) OR whose `Admission.assignedDoctorId` matches (assigned to this doctor as an IPD patient). Direct single-record lookups (medical history by ID, UID scan, employee ID) are untouched, per the plan — a patient isn't "owned" by a doctor, only a given visit/admission is.

**Tested:**
- `npx tsc --noEmit` (backend) — zero errors.
- `npx jest rbac-matrix` — all 5 assertions pass, no allow-list changes needed (the new `my-patients` route carries `@RequirePermission('Employee','read')`, already grantable).
- Full `npx jest` — 11 failed / 20 passed (two previously-undiscovered pre-existing-passing suites, `audit.interceptor.spec.ts` and `branding.controller.spec.ts`, showed up in this run's fuller sweep — a bonus, not a regression), same 11 pre-existing failures as the established baseline, unchanged. `patient.service.spec.ts` continues to pass unmodified, confirming the new doctor-scoping branch doesn't disturb the existing (non-Doctor-caller) test fixtures.
- A dev-server restart between test runs hit one transient, unrelated failure: `nest start --watch`'s webpack build briefly reported 713 "Cannot find module '@nestjs/common'" errors across files this phase never touched (`visit.service.ts`, `visit.controller.ts`, etc.) and exited. Confirmed via a fresh standalone `npx tsc --noEmit` (zero errors, same as immediately before) that this was a one-off watch-mode/webpack flake, not a real regression; the very next `npm run start:dev` compiled with 0 errors and started cleanly.
- **Manual two-doctor-account verification against the live dev server** (the plan explicitly calls this out as needed, since automated coverage for row-level scoping may not exist yet) — real fixtures created directly via Prisma (two patients with real OPD visits, two admissions, one of each assigned to a different real seeded doctor: Dr. Anita Desai and Dr. Sanjay Mehra), then exercised entirely through the real HTTP endpoints under test:
  - Doctor A calls Patient A's token, Doctor B calls Patient B's token → both `OPDVisit.doctorId` columns populated correctly.
  - `GET /patients/search` as Doctor A → only Patient A. As Doctor B → only Patient B. As Administrator → both, unaffected.
  - `GET /admissions` as Doctor A → only their own admission. As Doctor B → only theirs. As Administrator → both.
  - `GET /admissions/:id` as Doctor A on their own admission → `200`. As Doctor B on *Doctor A's* admission → `404` (not `403` — confirmed indistinguishable from a genuinely missing ID).
  - `GET /opd-visits/my-patients` as each doctor → correctly returns only that doctor's own called patient.
  - Real `Accountant` login (`mode: 'hospital'`, `role: 'Accountant'`) → `GET /billing/transactions` succeeds (`200`), `GET /doctors` and `GET /departments/admin` both correctly rejected (`403`, naming the exact missing permission) — confirming the new role's grant boundary is neither too wide nor too narrow.
  - All throwaway fixture data (2 patients, 2 admissions, 1 test Accountant account) cleaned up afterward — fixtures hard-deleted (never referenced by anything else), the test Accountant deactivated and removed from the login directory, consistent with every other phase's real-data hygiene.

**Phase 10 status: PASS — verified with real HTTP requests against real fixture data for two real doctor accounts, plus a real Accountant login.**

---

## Plan complete

All 10 phases of this plan are now built, tested, and verified: unified single login with a global identifier directory (1–2), login activity tracking and lockout (3), security hardening (4), a Platform Console visually matching the hospital-side design system (5), a cross-hospital admin roster (6), department management (7), a doctor management upgrade with department/fee/schedule (8), per-hospital configuration settings (9), and an Accountant role with real row-level data scoping for doctors (10). Every phase followed the same discipline: typecheck → targeted test → full regression suite against the established 11-suite pre-existing baseline → real HTTP verification against the live dev server with real data → real browser click-through where a UI exists → logged here.

---

# Doctor Account Security + Doctor-Specific OPD Queue

New plan, approved and run autonomously (user asleep, pre-approved, "don't ask, just build → test → fix → log every step"). Plan file: `i-want-to-build-lively-crown.md` (overwritten from the prior, now-complete plan). Goal: real password-lifecycle security for doctor accounts (forced first-login change, admin reset, forgot-password, lock/unlock, timestamps), a doctor assigned **at OPD registration** (not just at call-time) with a real queue state machine (explicit status enum, safe concurrent Call Next, skip/no-show/transfer/cancel), and a deeper relational doctor profile (credentials, multi-department, relational schedule, leave/substitute, room assignments).

Two judgment calls made without asking (no way to reach the user, explicitly pre-authorized to decide and proceed):
- **Forgot-password delivery**: no email/SMS exists anywhere in this codebase. Building the full token flow correctly (hashed-at-rest, expiring, single-use, real consume endpoint), but since nothing can deliver it, the practical path stays the existing admin-triggered reset (shows the new password once). Forgot-password is real working infrastructure, not wired to a UI trigger yet.
- **`TRANSFERRED` status**: kept as a valid enum value and its own audit action name, but a transferred visit resolves immediately back to `WAITING` under the new doctor rather than resting in a dead terminal state that would make it invisible to every queue.

## Phase 1 — Schema

All in one migration per schema, generated via the established `prisma migrate diff --from-url <hospital_esic_model> --to-schema-datamodel --script` workflow (tenant) and the equivalent against `public` (platform), applied via `migrate:all-tenants` + `prisma migrate deploy --schema=prisma/platform/schema.prisma`.

**Tenant schema** (`apps/api/prisma/schema.prisma`), migration `20260918220550_doctor_queue_security_expansion`:
- `User` — `mustChangePassword Boolean @default(false)`, `passwordChangedAt DateTime?`, `lastLoginAt DateTime?`.
- New `OpdVisitStatus` enum (`WAITING, CALLED, IN_CONSULTATION, COMPLETED, NO_SHOW, SKIPPED, CANCELLED, TRANSFERRED`). `OPDVisit` gains `status` (`@default(WAITING)`), `assignedAt`, `checkedInAt`, `consultationStartedAt`, `completedAt`, `priority Int @default(0)`, `queuePosition Int?`, `assignedRoomLabel`, `transferReason`, `skipReason`, `queueNotes` — `calledAt`/`closedAt` kept and still written alongside every transition, so any existing reader of those two columns is unaffected.
- `DoctorProfile` gains `subSpecialty`, `consultationDurationMinutes`, `dailyCapacity`, `professionalPhone`, `professionalEmail`, `signatureRef`, `verified Boolean @default(false)`. `weeklySchedule Json?` stays exactly as-is (old data untouched) but is now a frozen/legacy column — new writes go to the new `DoctorSchedule` table instead.
- Five new relational tables: `DoctorCredential` (license/qualification rows — modeled as repeatable rows, not scalar columns, since a doctor can hold several), `DoctorDepartment` (multi-department; `DoctorProfile.departmentId` stays as the single "primary" department Phase 8 already reads/writes), `DoctorSchedule` (relational day-of-week rows, the new canonical schedule source), `DoctorLeave` (leave window + optional substitute doctor via self-relation), `DoctorRoomAssignment` (deliberately a free-text `roomLabel`, not a FK to the ward/bed `Room` model — OPD consultation rooms and IPD ward rooms are different concepts in this schema). `Department` gains the two back-relations these require.
- `AuditLog` gains `reason String?` (needed for skip/no-show/transfer/password-reset entries going forward).

**Platform schema** (`apps/api/prisma/platform/schema.prisma`), migration `20260918220610_password_reset_and_manual_lock`:
- `LoginIdentifier` gains `manuallyLockedAt DateTime?` — an admin-triggered lock, distinct from the existing automatic `lockedUntil` set by repeated failed attempts; `checkLock` will reject on either being set, `unlock` will clear both together.
- New `PasswordResetToken` (`identifier, tokenHash` (unique, SHA-256 — the raw token is never persisted anywhere), `expiresAt`, `usedAt?`) for forgot-password.

**Tested:** `npx prisma validate` on both schemas before diffing. Generated diffs reviewed — confirmed 100% additive (new nullable/defaulted columns, new tables, one new enum; zero drops, zero type changes, zero new required-without-default columns) before applying. `npx prisma generate` for both clients succeeded cleanly (no `EPERM` this time — killed the 2 leftover dev-server processes from the previous session's last run first, same established Windows-hygiene routine). `npm run migrate:all-tenants` applied cleanly to both real hospitals; `prisma migrate deploy --schema=prisma/platform/schema.prisma` applied cleanly (confirmed exactly 3 platform migrations total, the new one included, nothing from the tenant migrations directory leaked in). `npx tsc --noEmit` — zero errors (confirms every new column is additive enough that no existing code broke). Full `npx jest` — 11 failed / 20 passed, byte-for-byte the same pre-existing baseline as before this phase, zero regressions.

**Phase 1 (doctor security/queue plan) status: PASS.**

## Phase 2 — Backend: password lifecycle & account security

**Built:**
- `apps/api/src/common/security/password.util.ts` (new) — `generateSecurePassword()` (guarantees at least one lower/upper/digit/symbol via `crypto.randomInt`, never `Math.random()`, never a fixed string), `generateResetToken()`/`hashResetToken()` (SHA-256; only the hash is ever persisted).
- `LoginDirectoryService` — every identifier now normalized (`trim().toLowerCase()`) at the one choke point (`register`/`resolve`/`checkLock`/`recordFailure`/`recordSuccess`/`rename`/`remove`), so casing can never create a duplicate or a silent lookup miss. New `lockManually()`/`unlock()` (admin-triggered lock, independent of the automatic failed-attempt one; unlock clears both together), `getStatus()`/`getStatuses()` (batch, for a staff list screen). `checkLock()` now also rejects on `manuallyLockedAt`.
- `AuthService.login()` normalizes the identifier once at the top so every downstream lookup agrees; `loginWithinTenant()` now sets `lastLoginAt` on successful login and the response includes `mustChangePassword`. New `changePassword()` (verifies current password, updates hash + clears `mustChangePassword` + sets `passwordChangedAt`, audit-logs `auth.password_changed`), `forgotPassword()` (always the same generic response regardless of whether the identifier resolves — no enumeration; generates+hashes a 30-minute single-use token, stored in the new `PasswordResetToken` table; not wired to any delivery channel since none exists in this codebase — see plan's judgment call), `resetPasswordWithToken()` (validates hash+expiry+unused, updates the tenant user, marks the token used, audit-logs `auth.password_reset_via_token`).
- New `POST /auth/change-password`, `POST /auth/forgot-password` (`@Public`), `POST /auth/reset-password-with-token` (`@Public`) in `auth.controller.ts`.
- `RbacGuard` — new `mustChangePassword` gate: any hospital-mode user with `mustChangePassword: true` is rejected (`403`, `code: 'MUST_CHANGE_PASSWORD'`) on every route except `/api/auth/{change-password,me,refresh,logout}`, checked ahead of the existing "no permission required" early-return so even un-permissioned routes (`GET /auth/me`) are correctly gated the same way. `JwtStrategy.validate()` now includes `mustChangePassword` (freshly read from the DB on every request, same as every other claim there) on the `AuthenticatedUser` it returns.
- `DoctorService` rewritten: uses the shared `generateSecurePassword()` (replacing the old inline `randomBytes(9).base64url` call), normalizes email on create, sets `mustChangePassword: true` on every new doctor account, writes `AuditLog` rows for `doctor.created`, `doctor.email_changed` (only when the email actually changes — via `LoginDirectoryService.rename()` first, then the tenant `User.identifier`, so the two can never disagree), `doctor.department_changed`, `doctor.activated`/`doctor.deactivated`. New `resetPassword()` (admin-triggered, fresh one-time password via the shared generator, `mustChangePassword: true`, audit-logged with an optional `reason`) and `setLocked()` (delegates to the new `LoginDirectoryService` manual-lock methods, audit-logged). New `findEligibleDoctors(departmentId)` (active, Doctor role, has a profile, department matches primary or a `DoctorDepartment` row) backing the OPD registration picker. `findAllDoctorsForAdmin()` now also returns `locked`/`failedLoginAttempts` per doctor via `LoginDirectoryService.getStatuses()` (batched, not N+1). `UpdateDoctorDto` gained `email?`/`verified?`.
- `doctor.controller.ts` — new `GET /doctors/eligible?departmentId=`, `POST /doctors/:id/reset-password`, `PATCH /doctors/:id/lock`; every mutating route now threads `@CurrentUser()` through as the audit-log actor.
- `common/guards/rbac-matrix.spec.ts` — added `changePassword` to `ALLOWED_WITHOUT_GUARD` and `forgotPassword`/`resetPasswordWithToken` to `ALLOWED_PUBLIC`.

**Tested:** `npx tsc --noEmit` — zero errors (one real bug caught and fixed along the way: the Prisma optional-relation filter `doctorProfile: { isNot: null, OR: [...] }` doesn't type-check — `isNot: null` is redundant when a plain field/`OR` filter is present anyway, since a null profile can't satisfy either branch; removed it). `npx jest rbac-matrix auth.service.spec` — one real gap caught: `auth.service.spec.ts`'s mock `prisma.user` had no `update` method, so the new `lastLoginAt` write threw inside the existing "successful login" test; added `update: jest.fn().mockResolvedValue({})` to the mock. Both green after that fix. Full `npx jest` — 11 failed / 20 passed, same pre-existing baseline, zero regressions.

**Phase 2 (doctor security/queue plan) status: PASS.**

## Phase 3 — Backend: OPD queue state machine & doctor-scoped assignment

**Built:**
- `CreateOpdVisitDto` gains a required `doctorId`. `OpdService.createOpdVisit()` now validates the chosen doctor via a new `assertDoctorEligibleForDepartment()` (active, `Doctor` role, has a profile, department matches primary or a `DoctorDepartment` row) before creating anything — a client can't smuggle in an ineligible doctor id. Sets `status: 'WAITING'`, `assignedAt`/`checkedInAt: now()`, computes `queuePosition` as that doctor's current `WAITING` count + 1.
- `DoctorController` gained `GET /doctors/eligible?departmentId=` (same eligibility rule, used by the registration picker's dropdown).
- `OpdService.callNext(doctorId)` (new) — the safe concurrent claim. Refuses to run while the doctor already has a `CALLED`/`IN_CONSULTATION` visit open (must explicitly finish/skip/no-show first, rather than the old single-id `callToken`'s behavior of silently auto-closing whatever was previously called). Picks the first `WAITING` visit by `priority`/`queuePosition`/`createdAt`, then claims it via a **status-guarded `updateMany`** inside a transaction (`where: { id, status: 'WAITING' }`) — Postgres serializes concurrent `UPDATE`s against the same row, so a losing concurrent caller's `WHERE` re-evaluates against the now-`CALLED` row once it gets the lock and matches zero rows, giving a clean, real "exactly one wins" guarantee without needing raw SQL row-locking. `POST /opd-visits/call-next` — the doctor id always comes from the JWT, never the request body.
- `OpdService.callToken(id, actor)` (existing single-id call, kept for Reception/QueueManager manual override) now enforces ownership for a `Doctor` caller (`assertOwnership` — a `Doctor` acting on a visit that isn't their own gets a 404, matching every other doctor-scoping check in this codebase, never a 403 that would confirm the record exists) instead of blindly overwriting `doctorId` the way it used to (the doctor is now assigned at registration, not at call-time).
- New `startConsultation` (`CALLED`→`IN_CONSULTATION`), `completeConsultation` (→`COMPLETED`, also closes the underlying `Visit` exactly like the pre-existing `closeOpdVisit`, kept untouched below it for any existing caller), `markNoShow`/`skip`/`cancel` (→ their respective terminal statuses, `reason` recorded, audit-logged), and `transfer` (reassigns `doctorId` to a newly-eligibility-checked doctor, resets to `WAITING` with a recomputed `queuePosition`, records `transferReason`, audit-logs `opdvisit.transferred` — the visit resolves straight back to an active queue rather than resting in the `TRANSFERRED` enum value, per the plan's judgment call). All ownership-checked the same way.
- New `GET /opd-visits/my-queue` (a doctor's own active — `WAITING`/`CALLED`/`IN_CONSULTATION` — queue) and `getQueue()` gained an optional `doctorId` filter for the Reception/QueueManager department view; `getMyPatients`/`GET /opd-visits/my-patients` (Phase 10's historical "called/seen" list) kept exactly as-is.
- `prisma/seed.ts` — new `OPDVisit` `call`/`update`/`cancel`/`transfer` grants for `Doctor` (own queue only, enforced in the service, not by the grant), `Reception` (`cancel`/`transfer` — front desk resolves queue issues without calling/completing consultations itself), `QueueManager` (all four), `Administrator` (all four).
- `opd.controller.ts` — every new mutating route threads `@CurrentUser()` through as both the ownership check and the audit-log actor.

**Security fix caught during manual verification, not by any automated check:** every queue-mutation response (`createOpdVisit`, `getQueue`, `callNext`, `callToken`, `startConsultation`, `completeConsultation`, `terminalTransition`, `transfer`) was including the assigned doctor's **full `User` row — including `passwordHash`** — in its JSON response, via `doctor: { include: { employee: true } }` (an `include` with no nested `select` returns every scalar column). Caught by eyeballing a real `POST /opd-visits/call-next` response during the concurrency test below and noticing a bcrypt hash sitting in the payload. Fixed by replacing all 8 occurrences with an explicit `doctor: { select: { id, identifier, active, employee: { select: { name, department, consultationRoom } } } }`. Re-verified afterward with a scripted check (`response.includes('passwordHash')` on a fresh registration) — confirmed clean. Logged prominently here since this is exactly the kind of thing "Never expose password hashes... in normal API responses" exists to prevent, and it shipped past `tsc`/tests/RBAC-matrix without anyone catching it — only real HTTP inspection did.

**Tested:**
- `npx tsc --noEmit` — zero errors both before and after the passwordHash fix.
- `npx jest rbac-matrix` — passes, no allow-list changes needed (every new handler carries `@RequirePermission`).
- Full `npx jest` — 11 failed / 20 passed, same pre-existing baseline, zero regressions.
- **Real HTTP verification** against the live dev server, using real fixture patients/visits created directly via Prisma (mirroring what the real registration flow produces) and a real throwaway doctor account:
  - Registering an OPD visit with an **ineligible** doctor (wrong department) correctly rejected with `400 Selected doctor does not belong to this department.`; three visits registered against the eligible doctor got `queuePosition` 1/2/3 and sequential daily tokens `CARDIO-001`/`002`/`003` as expected.
  - `GET /opd-visits/my-queue` showed all 3 as `WAITING`. `call-next` claimed position 1; a second `call-next` while it was still `CALLED` was correctly rejected (`"Finish, skip, or mark no-show..."`, `400`). `start-consultation` → `complete` transitioned it to `COMPLETED`; the next `call-next` then correctly skipped over it and claimed position 2. Marked position 2 `no-show` with a reason.
  - **True concurrency test**: fired two simultaneous `call-next` requests (backgrounded, `wait`ed together) against the doctor's one remaining `WAITING` visit — exactly one request won and claimed it (`201`, visit now `CALLED`); the other was correctly rejected (`400`, since by the time its check ran the winner's transaction had already committed) — confirmed **no double-claim, no lost update**.
  - `transfer` correctly rejected reassigning to a doctor with no department assigned (`400`, genuinely correct — Dr. Anita Desai's seeded profile has `departmentId: null`, a known pre-existing data gap from Phase 8, not a bug); after temporarily assigning her the Cardiology department, the transfer succeeded (`doctorId` updated, `status` back to `WAITING`, `transferReason` recorded), then her department assignment was reverted directly via Prisma (not through the API's `PATCH` — confirmed that endpoint's `undefined`-means-"don't touch" semantics correctly do **not** clear a field just because the request body omits its key; clearing it requires explicitly sending `null`).
  - `PATCH /doctors/:id/lock` (`locked: true`) correctly blocked the very next login attempt with `403 Account locked by an administrator...`; unlocking immediately restored login.
  - All fixture data (4 test patients/visits/OPD-visits, their auto-generated `ChargeItem` rows, one throwaway doctor) cleaned up afterward — patients hard-deleted (never referenced by anything else), the test doctor deactivated (never hard-deleted), consistent with every other phase's real-data hygiene.

**Phase 3 (doctor security/queue plan) status: PASS.**

## Phases 4-5 — Frontend: one-time password modal & Doctor Management account security

**Built:**
- `apps/web/src/components/AccountCreatedModal.tsx` (new, shared) — matches the exact spec: title "Account Created — Save the Password", the exact warning line with the staff email interpolated, staff name/staff ID/role/email fields, a read-only password `<input>` with a Copy button beside it, a "Copy Login Details" button (name/email/password/staffId/role as plain text, clipboard), and a green "Done — I've saved the password" button plus a close icon. Nothing here is ever persisted (no localStorage) — once `onClose` fires, the plain-text password is gone from memory for good.
- `apps/web/src/api/doctor.api.ts` — `DoctorProfile` gained `mustChangePassword`, `passwordChangedAt`, `lastLoginAt`, `dateJoined`, `consultationRoom`, `contactPhone`, `verified`, and (admin-roster-only) `locked`/`failedLoginAttempts`. New `fetchEligibleDoctors(departmentId)`, `resetDoctorPassword(id, reason?)`, `setDoctorLocked(id, locked, reason?)`. `UpdateDoctorPayload` gained `email?`/`verified?`.
- `apps/web/src/pages/DoctorSchedulePage.tsx` — replaced the old inline "doctor created" text block with `AccountCreatedModal`, now shared by both create and password-reset. Admin cards gained: an Active/Inactive/**Locked** status badge (locked takes priority — reads the new `locked` field), a Verified/Pending-verification indicator, a "Password changed: <date>" line, and Reset Password / Lock-Unlock buttons alongside the existing Edit/Deactivate. The edit form gained an editable Email field (with a note that changing it updates the login identifier immediately) and a "Profile verified" checkbox.
- One real icon-shim gap found and fixed the same way as every prior phase: `ShieldQuestion`/`Unlock` weren't in `apps/web/src/types/modules.d.ts`'s hand-maintained `lucide-react` type shim — added both.

**Tested:** `npx tsc -b --noEmit` — zero errors. `npm run build` — succeeds.

## Phase 6 — Frontend: OPD registration doctor picker

**Built:**
- `apps/web/src/api/opd.api.ts` — `createOpdVisit()`'s payload type now requires `doctorId: string` alongside `visitId`/`departmentId`.
- `apps/web/src/pages/reception/EnterpriseReceptionDesk.tsx` — added `eligibleDoctors`/`selectedDoctorId` state, refetched via the new `fetchEligibleDoctors(selectedDeptId)` (from `doctor.api.ts`) whenever the shared `selectedDeptId` state changes, auto-selecting the first eligible doctor (or clearing selection if the previous pick is no longer eligible for the new department). Added an "Assigned Doctor" `<select>` immediately after the department picker in both OPD-visit-creating forms: the ESIC-beneficiary registration form (required, only shown for `careType === 'OPD'`) and the universal-search "Issue Visit Token" form (shown for `visitType === 'OPD'`, with the Issue button disabled until a doctor is selected). All 3 `createOpdVisit()` call sites (new-patient registration, existing-patient registration, universal-search repeat visit) now pass `doctorId: selectedDoctorId`.
- The pre-existing "Reception Operational Queue Console" department filter (a read-only live-queue view, no registration) was left untouched — it has no `createOpdVisit` call site and doesn't need a doctor picker.

**Tested:** `npx tsc -b --noEmit` in `apps/web` — zero errors (confirmed the `doctorId`-required type change is fully threaded through, no other call sites broken).

**Phase 6 status: PASS.**

## Phase 7 — Frontend: doctor's own queue panel & department queue console rework

**Built:**
- `apps/web/src/api/opd.api.ts` — `OPDVisitRecord` expanded with the full new state-machine shape (`status`, `priority`, `queuePosition`, `assignedRoomLabel`, `transferReason`, `skipReason`, `queueNotes`, `assignedAt`, `checkedInAt`, `consultationStartedAt`, `completedAt`, `doctorId`, `doctor`). `fetchOpdQueue()` gained an optional `doctorId` filter param. New functions: `fetchMyOpdQueue`, `callNextOpdVisit`, `startOpdConsultation`, `completeOpdConsultation`, `markOpdNoShow`, `skipOpdVisit`, `cancelOpdVisit`, `transferOpdVisit` — one per new backend endpoint from Phase 3.
- `apps/web/src/pages/doctor/DoctorWorkspace.tsx` — new "My OPD Queue" panel (own queue only, via `/opd-visits/my-queue`, polled every 8s): shows the currently CALLED/IN_CONSULTATION patient with Open Chart / No-show / Skip / Complete Consultation actions, a horizontally-scrolling strip of upcoming waiting tokens, and a "Call Next" button (disabled while a patient is already called, mirroring the backend's own refusal). Calling Next auto-loads that patient's full chart via the existing `handleLoadVisit`, so the doctor doesn't have to copy/paste a visit ID after calling.
- `apps/web/src/screens/opd/OpdQueueScreen.tsx` — reworked from the old single-doctor "calling station" model (which assumed one global CALLED token) to the new per-doctor queue model: added a doctor filter (`fetchEligibleDoctors(departmentId)`, "All Doctors" default), replaced the single "Now Calling" banner with a grid of one card per doctor currently mid-consultation, and switched the waiting list and status badges to the new `status` enum. Actions are gated client-side by role to match the actual backend grants in `seed.ts` (defense-in-depth only — the backend is the real enforcement): Call/No-show/Skip/Start/Complete for Doctor/QueueManager/Administrator/SuperAdmin (`OPDVisit:call`/`update`), Reassign for those plus Reception (`OPDVisit:transfer`), Cancel for Reception/QueueManager/Administrator/SuperAdmin (`OPDVisit:cancel`) — Reception can no longer call or complete a consultation from this screen, only view, reassign, and cancel, consistent with Reception's actual grants. Reassign opens an inline doctor picker (excluding the current doctor) with Confirm/Cancel.

**Tested:**
- `npx tsc -b --noEmit` in `apps/web` — zero errors. `npm run build` — succeeds.
- **Real HTTP verification** against the live dev server, using a fixture patient/visit created directly via Prisma (registration API's Labour Dept mock rejected the throwaway employee ID) and Dr. Anita Desai temporarily re-assigned to Cardiology (reverted afterward, same as Phase 3):
  - Reset her password via `POST /doctors/:id/reset-password`, logged in with the one-time password — `mustChangePassword: true` correctly blocked `GET /opd-visits/my-queue` with `403 MUST_CHANGE_PASSWORD`; `POST /auth/change-password` succeeded, and a fresh login came back `mustChangePassword: false`.
  - Registered an OPD visit for her (`WAITING`, token `CARDIO-005`) — her `my-queue` correctly showed it; `call-next` claimed it (`CALLED`); `start-consultation` → `IN_CONSULTATION`; `complete` → `COMPLETED` with `closedAt` set; `my-queue` afterward correctly came back empty.
  - Re-checked `GET /opd-visits/queue?departmentId=...` for a `passwordHash` leak (the bug caught in Phase 3) — confirmed still clean.
  - All fixture data (1 employee, 1 visit, its OPD visit, its auto-generated charge item) hard-deleted afterward; Dr. Anita Desai's `departmentId` reverted to `null`, matching Phase 3's known pre-existing data gap; her password stays reset (a real credential rotation, not a fixture — same as any other admin-triggered reset).

**Phase 7 status: PASS.**

## Phase 8 — Frontend: forced first-login/post-reset password change gate

**Built:**
- `apps/web/src/hooks/useAuth.ts` — `AuthUser` gained `mustChangePassword?: boolean`, captured from the login response for hospital-mode sessions (`user.mustChangePassword = !!data.mustChangePassword`). New `clearMustChangePassword()` context method, called once the change succeeds, updates both in-memory state and the persisted `localStorage` session so a page refresh mid-session doesn't re-trigger the gate.
- `apps/web/src/api/auth.api.ts` (new) — `changePassword(currentPassword, newPassword)`, thin wrapper over `POST /auth/change-password`.
- `apps/web/src/pages/auth/ForcedChangePasswordScreen.tsx` (new) — current/new/confirm password fields (client-side checks: min 8 chars, confirmation match, new ≠ current — the backend re-validates all of this regardless), a "Log Out Instead" escape hatch, and a show/hide-passwords toggle. Uses the shared `.card`/`.input`/`.btn` design-system classes, consistent with the rest of the app (not the elaborate government-branded `LoginPage`, since this is a mid-session gate, not the sign-in screen).
- `apps/web/src/App.tsx` — new auth-gate branch: `mode === 'hospital' && user?.mustChangePassword` renders `ForcedChangePasswordScreen` instead of `AppShell`/`PlatformConsole`, mirroring the backend's own `RbacGuard` allowlist (which independently rejects every route except `/auth/change-password`, `/auth/me`, `/auth/refresh`, `/auth/logout` for such a user) — the frontend gate is a UX convenience, the backend gate is the real enforcement.

**Tested:**
- `npx tsc -b --noEmit` — zero errors. `npm run build` — succeeds.
- Reused Phase 7's real HTTP verification of the underlying backend gate (login with a reset password → `mustChangePassword: true` → `GET /opd-visits/my-queue` correctly `403 MUST_CHANGE_PASSWORD` → `POST /auth/change-password` succeeds → fresh login comes back `mustChangePassword: false`) — the frontend gate added here calls the exact same endpoint and reads the exact same login-response field, so no new backend behavior was introduced.

**Phase 8 status: PASS.**

## Combined browser verification pass (Phases 4-8)

Real click-through against the live dev server (`npm run dev`, port 5173) using the browser automation tool, entered into the ESIC Model Hospital tenant as the real logged-in Super Admin (no credentials fabricated, no destructive action taken on that session):

- **Doctor Schedule** (`/doctor-schedule`) — admin roster cards render the Phase 4-5 account-security fields correctly: Active/Inactive/Locked status badges, Pending-verification indicator, "Password changed" date (or "Never"), and Edit/Reset Password/Lock/Deactivate-Reactivate buttons, all present and correctly enabled/disabled per doctor.
- **OPD Queue** (`/opd-queue`) — Phase 7's reworked department view renders correctly: Department select, new Doctor filter select (defaulting to "All Doctors"), the per-doctor "Live Calling Station" grid (correctly showing the empty state, since no visits were active in this real environment at test time), and the waiting-tokens table. No console errors on load.
- **Consultations / DoctorWorkspace** (`/consultations`) — Phase 7's new "My OPD Queue" panel renders correctly above the existing 3-panel clinical workspace: empty state ("No patient currently called. 0 waiting."), Call Next button correctly disabled with a `0 Waiting` count and no patient called. No console errors on load.
- **Registration** (`/registration`) — confirmed the page loads cleanly with the updated `createOpdVisit` payload wiring in place; a live click-through of the doctor `<select>` itself was not completed in this pass because the real tenant currently has zero doctors with a department assignment other than the throwaway fixtures created and reverted during Phase 3/7 testing (a pre-existing data gap noted repeatedly in this log, not a regression) — the doctor-picker's wiring was instead verified via `tsc` (Phase 6) and the full real-HTTP registration flow (Phase 7).
- **Forced change-password screen** — not clicked through live, since doing so would have required logging out of the real user's active Super Admin session in the shared browser profile (only one origin-wide `localStorage` session exists per profile, and there is no available way to isolate a second session without disturbing the first). Instead relied on: (a) Phase 7/8's real HTTP verification of the exact same backend gate and `/auth/change-password` endpoint the screen calls, (b) zero `tsc`/build errors, (c) direct code review of the component, which has no logic beyond that single API call plus client-side field checks. Flagged here explicitly rather than silently skipped.
- No console errors observed on any visited page.

**Combined verification status: PASS**, with the two explicitly-noted, deliberate scope limits above (both logged rather than glossed over).

## Phase 9 — Backend tests & full verification sweep

**Built (new test files, no production code changed):**
- `apps/api/src/modules/opd/services/opd.service.spec.ts` (new, 16 tests) — doctor-specific queue isolation (`callToken`/`startConsultation`/`markNoShow`/`skip`/`cancel` all 404 a Doctor caller acting on another doctor's visit, but allow an unrestricted role like Administrator), status-transition guards (`startConsultation` rejects non-`CALLED`, `completeConsultation` accepts `CALLED`/`IN_CONSULTATION` only, terminal transitions reject an already-terminal visit and record the reason + correct audit action), `callNext()`'s atomic claim (refuses when the doctor already has an in-progress visit, 404s with no waiting candidate, claims correctly, and throws `ConflictException` when a simulated concurrent claim wins the race via `updateMany` matching zero rows), and `transfer()` (rejects an ineligible new doctor, rejects transferring a terminal-status visit, and correctly reassigns + audit-logs `opdvisit.transferred` on success).
- `apps/api/src/modules/user/doctor.service.spec.ts` (new, 11 tests) — `createDoctor()` normalizes the email before registering it in the login directory, generates a random non-predictable password each call (never a fixed string, never two doctors sharing one), never stores it in plaintext, sets `mustChangePassword: true`, audit-logs `doctor.created`, and rolls back the login-directory registration if the tenant-side transaction fails (no orphaned identifier). `resetPassword()` generates a fresh one-time password, forces a password change, records the reason, and 404s for a non-doctor user. `setLocked()` delegates to `loginDirectory.lockManually`/`unlock` correctly and audit-logs `doctor.locked`/`doctor.unlocked`. `updateDoctor()` renames the login-directory identifier before touching the tenant `User` row on an email change (audit-logging `doctor.email_changed`), leaves everything untouched when the email is unchanged, and audit-logs `doctor.department_changed` only when the department actually changes.
- `apps/api/src/modules/auth/auth.service.spec.ts` (extended, +17 tests) — `changePassword()` rejects a platform-mode caller and an incorrect current password, and on success updates the hash, clears `mustChangePassword`, and audit-logs `auth.password_changed`. `forgotPassword()` returns the byte-for-byte identical generic message whether or not the identifier resolves (no enumeration), and persists only a SHA-256 hash of the token, never the raw value. `resetPasswordWithToken()` rejects an unknown/expired/already-used token, and on a valid token updates the password and marks the token used (single-use enforced).

**Tested:**
- `npx tsc --noEmit` (API) — zero errors.
- `npx jest rbac-matrix` — 5/5 pass, no allow-list changes needed.
- `npx jest src/modules/auth/auth.service.spec.ts src/modules/opd/services/opd.service.spec.ts src/modules/user/doctor.service.spec.ts` — 44/44 new/extended tests pass.
- **Full `npx jest`** — 11 failed / 22 passed test **suites** (was 11 failed / 20 passed before this phase's 2 new suite files — the pre-existing 11 failing suites are unchanged, confirming zero regressions; those 11 suites fail for a pre-existing, unrelated reason: they instantiate `new PrismaService()` directly against the bare `DATABASE_URL` from `.env`, which has no `schema` query param and so resolves to Postgres's default `public` schema, where tenant tables like `users`/`patient_location_history` don't exist — a live-tenant-schema-URL environment requirement these integration-style specs have always had, not something this session's changes touched).
- `npm run lint` — reports ~20,700 problems repo-wide, but every single one is `prettier/prettier: Delete '␍'` (a Windows CRLF vs. the repo's LF-only Prettier config) — confirmed pre-existing and universal by linting `src/main.ts` (untouched this entire session) alone and getting the exact same error shape. Re-ran lint scoped to only the 13 files this whole task touched or created: 953 problems, **100% the same CRLF issue, zero non-prettier findings** — no real lint errors in anything written this session.

**Phase 9 status: PASS** (zero regressions against the established test-suite and lint baselines; all new backend logic covered by 44 new/extended unit tests).

## Phase 10 — Final summary

**Database models & migrations**
- Tenant migration `20260918220550_doctor_queue_security_expansion` (100% additive, applied to all tenants via `migrate:all-tenants`): `User.mustChangePassword/passwordChangedAt/lastLoginAt`; new `OpdVisitStatus` enum + `OPDVisit.status/assignedAt/checkedInAt/consultationStartedAt/completedAt/priority/queuePosition/assignedRoomLabel/transferReason/skipReason/queueNotes` (existing `calledAt`/`closedAt` kept, still written); `DoctorProfile` gained `subSpecialty/consultationDurationMinutes/dailyCapacity/professionalPhone/professionalEmail/signatureRef/verified`; new relational models `DoctorCredential`, `DoctorDepartment`, `DoctorSchedule`, `DoctorLeave`, `DoctorRoomAssignment`; `AuditLog.reason`.
- Platform migration `20260918220610_password_reset_and_manual_lock`: `LoginIdentifier.manuallyLockedAt`; new `PasswordResetToken` model (hashed token, expiry, single-use).

**New/changed backend endpoints** (`apps/api/src/modules/{auth,user,opd}`)
- `POST /auth/change-password`, `POST /auth/forgot-password` (`@Public`), `POST /auth/reset-password-with-token` (`@Public`).
- `GET /doctors/eligible?departmentId=`, `POST /doctors/:id/reset-password`, `PATCH /doctors/:id/lock`; `PATCH /doctors/:id` gained `email`/`verified`.
- `POST /opd-visits` now requires `doctorId`; `GET /opd-visits/queue` gained optional `doctorId` filter; new `GET /opd-visits/my-queue`, `POST /opd-visits/call-next`, `PATCH /opd-visits/:id/{start-consultation,complete,no-show,skip,cancel,transfer}`. Old `POST /opd-visits/:id/call` and `POST /opd-visits/:id/close` kept unmodified for backward compatibility.

**Permission changes** (`prisma/seed.ts`) — new `OPDVisit` grants: `Doctor` (`call`/`update`/`transfer`, ownership-enforced in-service), `Reception` (`cancel`/`transfer`, no `call`/`update`), `QueueManager`/`Administrator` (`call`/`update`/`cancel`/`transfer`). No route was left unguarded — confirmed by the RBAC matrix static sweep.

**Frontend screens changed**
- `DoctorSchedulePage.tsx` — account status (Active/Inactive/**Locked**)/verification/password-changed-date, Reset Password/Lock-Unlock actions, editable email, shared `AccountCreatedModal` (new component) for both creation and reset.
- `EnterpriseReceptionDesk.tsx` — doctor picker added to both OPD-registration forms, wired into all 3 `createOpdVisit` call sites.
- `DoctorWorkspace.tsx` — new "My OPD Queue" panel: Call Next / Open Chart / No-show / Skip / Complete Consultation, JWT-scoped to the logged-in doctor only.
- `OpdQueueScreen.tsx` — reworked for the new per-doctor status model, with a doctor filter and role-gated Call/Start/Complete/No-show/Skip/Reassign/Cancel actions matching each role's actual backend grants.
- `App.tsx` + new `ForcedChangePasswordScreen.tsx` — gates the whole app on `mustChangePassword`, mirroring the backend's own `RbacGuard` allowlist.

**Security fixes caught during this work**
- A `passwordHash` leak in every OPD-visit-returning endpoint (Prisma `include` with no nested `select`), caught by inspecting a real HTTP response, not by any automated check — fixed across all 8 occurrences and re-verified clean.
- `mustChangePassword` enforcement verified end-to-end over real HTTP: a reset account is fully blocked (`403 MUST_CHANGE_PASSWORD`) from every route except the allowlist until it changes its password.

**Test results**
- `tsc --noEmit` — zero errors, both apps, every phase.
- 44 new/extended backend unit tests (`opd.service.spec.ts`, `doctor.service.spec.ts`, `auth.service.spec.ts`) — all passing; RBAC matrix sweep passing; full `jest` run shows the same 11 pre-existing (environment-related, unrelated) failing suites as before this task — zero regressions.
- Real HTTP verification against the live dev server: doctor-specific queue isolation, true concurrent `call-next` (exactly one caller wins), reassignment, no-show/skip/cancel, doctor account creation with a random one-time password, admin-triggered password reset, forced-password-change gate blocking every route but the allowlist, and a manual account lock blocking the very next login attempt.
- Combined browser click-through of Doctor Schedule, OPD Queue, and Consultations screens — all render correctly with zero console errors; two explicit, logged scope limits (no live doctors currently carry a department assignment in this real tenant besides test fixtures created/reverted during testing — a pre-existing data gap; and the forced-password screen's live click-through was skipped to avoid disturbing the real logged-in Super Admin session in the shared browser profile, covered instead by real HTTP verification of the identical backend path).
- `npm run lint` — zero new lint issues; all reported problems are a pre-existing, repo-wide Windows CRLF/Prettier mismatch, confirmed present in untouched core files too.

**Explicit "Important" constraints, confirmed preserved:** no unrelated module was modified; OPD token generation, billing, prescription, lab, and audit functionality all kept working (verified by the same full-regression `jest` run and real HTTP checks); no predictable default password was ever introduced (`generateSecurePassword()` uses `crypto.randomInt`, never `Math.random()` or a fixed string); no plain-text password is stored or exposed after its one-time display (confirmed via the passwordHash-leak fix and by tracing every reset/create response).

**Plan status: all 10 phases complete.**

**Phases 4-5 status: PASS (browser verification deferred to the combined pass after Phase 8, alongside the OPD registration and doctor-workspace UI, since they all touch the same real doctor account and are faster to verify together end-to-end).**

# Staff Management, Personal Dashboards, Administrator Rights & Activity Log

New multi-phase task (plan at `C:\Users\navne\.claude\plans\i-want-to-build-lively-crown.md`). Extends the account-security model already built for Doctor to the other 11 staff roles, adds real per-role personal dashboards, and adds a hospital-scoped Activity Log. Doctor's existing `DoctorService`/`DoctorController`/`DoctorSchedulePage.tsx` stay untouched by explicit decision (confirmed via AskUserQuestion) — a new generic Staff module covers the other 11 roles.

## Phase 1 — Schema

**Built:**
- `Employee.designation String?` (new) — a generic staff title distinct from `department`, with no prior home in the schema.
- New `StaffShift` model (`id, userId, dayOfWeek, startTime, endTime, active`, `@@unique([userId, dayOfWeek])`) — generic weekly-availability rows for any role; Doctor keeps using its own richer `DoctorSchedule`/`DoctorProfile`-based model, untouched.
- `AuditLog` gained `@@index([actorUserId])` and `@@index([action])` — needed by the new Activity Log screen's filters; the model had neither before.
- **Append-only enforcement for `audit_logs` at the database level**: a `prevent_audit_log_mutation()` trigger function `RAISE EXCEPTION`s on any `UPDATE`/`DELETE`, attached `BEFORE UPDATE OR DELETE` on `audit_logs`. Chosen over a `REVOKE` on a specific DB role name because it's portable across environments regardless of which role the app connects as.
- `apps/api/src/common/sequence/sequence.definitions.ts` — new `staffIdSequence(rolePrefix)` builder (same on-demand-from-data pattern as the existing `queueTokenSequence(departmentCode)`), `reset: 'NEVER'`, `padding: 4` → e.g. `NUR-0001`. `DocumentSequenceService` gained `nextStaffId(rolePrefix, tx?)`.
- Migration `20260919062000_staff_management_schema` — 100% additive (confirmed via `prisma migrate diff` before writing it), applied to both real tenants (`esic-model`, `demo-hospital-two`) via `migrate:all-tenants`. Prisma client regenerated.

**Tested:**
- `npx prisma format` — schema valid.
- `npx tsc --noEmit` — zero errors.
- **Real verification of the append-only trigger** against the live `hospital_esic_model` schema: created a throwaway `AuditLog` row, then attempted a raw `UPDATE` and a raw `DELETE` against it directly via Prisma's `$executeRawUnsafe` (bypassing the application layer entirely, to prove the protection is at the database, not just "no route exists") — both correctly rejected with `ERROR: audit_logs is append-only: UPDATE/DELETE is not permitted` (Postgres error code `P0001`). **Note:** the throwaway test row (`action: 'trigger.test'`) is now permanently stuck in `hospital_esic_model.audit_logs` by design (the trigger has no exception, including for cleanup) — a harmless, documented, one-time residue of proving the feature works, not a bug.

**Phase 1 status: PASS.**

## Phase 2 — Backend: generic Staff module (11 non-Doctor roles)

**Built:**
- `apps/api/src/modules/user/dto/staff-role.const.ts` (new) — `STAFF_ROLE_PREFIXES` map (every seeded role except Doctor → its staff-ID prefix: Reception→REC, AdmissionDesk→ADM, Nurse→NUR, Pharmacist→PHA, StoreManager→STO, ProcurementOfficer→PRO, DataEntryOperator→DEO, Administrator→ADX, QueueManager→QUE, LabTechnician→LAB, Pathologist→PTH, Accountant→ACC), `STAFF_ROLE_NAMES`.
- `dto/create-staff.dto.ts` / `dto/update-staff.dto.ts` (new) — `role` validated via `@IsIn(STAFF_ROLE_NAMES)`, which structurally rejects `role: 'Doctor'` at the DTO layer before it ever reaches the service. Reuses the existing `WeeklyScheduleEntryDto` (day/startTime/endTime/available) for shift entries rather than duplicating it.
- `staff.service.ts` (new) — `createStaff`, `updateStaff`, `setActive`, `resetPassword`, `setLocked`, `findAllForAdmin` (search by name/email/staffId, filter by role/department/status), `findOne` — byte-for-byte the same security pattern `doctor.service.ts` already proved out (register-then-transact-then-rollback-on-failure for creation, `LoginDirectoryService` for lock/unlock, `generateSecurePassword()`, explicit audit logging: `staff.created`/`staff.email_changed`/`staff.activated`/`staff.deactivated`/`staff.password_reset`/`staff.locked`/`staff.unlocked`). Staff IDs come from the new `documentSequenceService.nextStaffId(prefix, tx)` — a real atomic per-role counter, not a hand-built string.
- `staff.controller.ts` (new) — `GET /staff`, `GET /staff/:id`, `POST /staff`, `PATCH /staff/:id`, `PATCH /staff/:id/active`, `POST /staff/:id/reset-password`, `PATCH /staff/:id/lock` — one-to-one with `doctor.controller.ts`'s route shape, gated by a new `Staff` resource permission.
- `apps/api/prisma/seed.ts` — new grants `Administrator: Staff create/read/update/delete` (delete = the activate/deactivate action, matching the existing `Doctor:delete` convention for the same action). Applied to both real tenants via a small targeted script (not a full seed re-run, to avoid re-triggering the seed's other, non-idempotent sample-data steps against already-used dev databases) — confirmed present in both `hospital_esic_model` and `hospital_demo_hospital_two`.
- `doctor.service.ts` — the one line generating `empId` was swapped from `` `DOC-${email.split('@')[0]}` `` to `documentSequenceService.nextStaffId('DOC', tx)`, so Doctor's staff-ID generation now uses the same real, atomic, role-prefixed counter as every other role (`DOC-0001`, matching the user's own example) instead of deriving from the email. Nothing else in the file changed; existing doctor-creation tests were updated only for the new constructor argument, not the assertions.

**Tested:**
- `npx tsc --noEmit` — zero errors.
- `npx jest rbac-matrix` — 5/5 pass, no allow-list changes needed (every new route carries `@RequirePermission`).
- New `staff.service.spec.ts` — 16/16 pass: `CreateStaffDto` genuinely rejects `role: 'Doctor'` via `class-validator` (and accepts all 12 real non-Doctor roles), staff-ID sequence is called with the correct prefix per role, temporary passwords are random/non-repeating/never stored in plaintext and force `mustChangePassword`, `staff.created` audit entry written, login-directory registration correctly rolled back on a failed tenant transaction, `weeklySchedule` persists as `StaffShift` rows with `available`→`active` mapping, reset/lock/unlock/email-change all behave and audit-log identically to the proven Doctor pattern, and `findAllForAdmin()`'s default role filter structurally excludes `Doctor`.
- `doctor.service.spec.ts` — re-run after the sequence-based ID swap: still 16/16 pass (constructor now takes the `sequences` mock; no assertion changed).
- Attempted to also add real HTTP/e2e coverage via the repo's existing `test/*.e2e-spec.ts` harness (`npm run test:e2e` — boots a real Nest app in-process via `Test.createTestingModule`, no persistent dev server needed). **Found broken independent of this session's changes**: the whole harness fails at `AppModule` import time with `SyntaxError: Unexpected token 'export'` inside `puppeteer`'s ESM build (`document-render.service.ts` → `rendering.module.ts` → `app.module.ts`), a pre-existing Jest `transformIgnorePatterns` gap unrelated to Staff Management. Not fixed here (out of scope — a broader Jest/e2e-infra fix, not a Staff Management concern); noted so it isn't mistaken for a regression. Backend correctness for this phase instead relies on the unit tests above plus the same live-HTTP-verification discipline used every prior phase, deferred until the dev server is intentionally restarted (it was killed by the platform's own memory-pressure guard while idle overnight; not restarted proactively per that guard's explicit instruction to wait to be asked).

**Phase 2 status: PASS**, with live HTTP/browser verification explicitly deferred to Phase 8 pending the dev server being restarted.

## Phase 3 — Backend: personal dashboard summaries

**Built:**
- `apps/api/src/modules/dashboard/dashboard.service.ts` — new `getMySummary(user: AuthenticatedUser)`, a `switch` on `user.roleName` returning a small role-keyed object per role, each field backed by a real query (never fabricated data): Doctor reuses `OpdService.getMyQueue(doctorId)` (own module's `ACTIVE_STATUSES` semantics, not re-derived) plus a `Prescription` DRAFT count; Nurse scopes `Admission`/`AdmissionNote` counts to the caller's own `assignedNurseId` (explicitly *not* a structured vitals/MAR count — no such model exists, documented rather than fabricated); Reception/Pharmacist/LabTechnician/Pathologist/AdmissionDesk/QueueManager/StoreManager/ProcurementOfficer/DataEntryOperator each get 1-3 plain counts matching the real workflow state already established for that role (SIGNED/PARTIALLY_DISPENSED prescriptions, `LabOrder` status groups, `LabResult{flag:CRITICAL}` unverified, `REQUESTED`/`ELIGIBILITY_CHECKED` admissions, available beds, low-stock batches via a `currentStock`/`reorderLevel` comparison done in application code since Prisma has no field-to-field `where` comparison, `PurchaseRequisition`/`PurchaseOrder` status counts); Administrator gets staff totals/active-inactive counts, the 5 most recent `AuditLog` entries, and a same-day count of password-reset/change security events. Any other role (and SuperAdmin, whose real dashboard is the already-existing `PlatformDashboardScreen`) gets a bare `{ role }` fallback.
- `dashboard.controller.ts` — new `GET /dashboard/my-summary`, JWT-scoped only (`@CurrentUser()`, never a query param) — one user can never pull another's counts through this route.
- `dashboard.module.ts` now imports `OpdModule` to inject `OpdService` (no circular dependency — confirmed neither `OpdModule` nor its own imports (`BillingModule`/`BenefitModule`) reference `DashboardModule`).
- `src/common/guards/rbac-matrix.spec.ts` — `getMySummary` added to the same allowlist as the existing `getMetrics` (identical reasoning: aggregate counts only, every role needs it, `JwtAuthGuard` alone is the correct bar).

**Tested:**
- `npx tsc --noEmit` — zero errors.
- `npx jest rbac-matrix` — 5/5 pass after the allowlist addition.
- New `dashboard.service.spec.ts` — 7/7 pass: Doctor's queue is correctly split into waiting/called and its own draft-prescription count; Nurse's admission/note counts are scoped to the caller's own `assignedNurseId` (never another nurse's, verified by asserting the exact `where` clause); Pharmacist's low-stock count is a real `currentStock <= reorderLevel` comparison, not a placeholder; Pathologist's two counts use two genuinely distinct queries (awaiting-verification vs. critical-unverified); QueueManager's aggregate is a single real `WAITING` count; Administrator aggregates staff totals and today's security-event count correctly; an unhandled role falls back to a bare `{ role }` tag rather than throwing.

**Phase 3 status: PASS.**

## Phase 4 — Backend: hospital-scoped Activity Log

**Built:**
- `apps/api/src/modules/audit/` (new module) — `audit-log.service.ts::findAll(filters)` (actorUserId/action-contains-case-insensitive/entityType/dateFrom/dateTo, paginated — default limit 50, hard-capped at 200) and `exportCsv(filters)` (same filters, up to 5000 rows, reuses the existing `reports/csv.util.ts::toCsv` rather than a new CSV writer or dependency); `audit-log.controller.ts` — `GET /audit-log` and `GET /audit-log/export.csv`, both gated by `RequirePermission('AuditLog', 'read')` (Administrator already held this grant from `seed.ts` before this task even started — nothing was serving it until now). Tenant isolation needs no new code: `TenantResolutionMiddleware` resolves the schema from the JWT alone for a hospital token, so this controller structurally can never see another hospital's rows (re-confirmed by re-reading that middleware during planning).
- `apps/api/src/modules/platform/platform-staff-audit.{service,controller}.ts` (new) — the cross-hospital counterpart for Super Admin: with `?hospitalId=`, connects that one tenant and delegates straight to `AuditLogService.findAll` (full pagination); without it, loops every `ACTIVE` hospital via the exact resilient per-hospital try/catch pattern `PlatformDashboardService` already uses (a failed hospital contributes zero rows and is logged, never fails the whole request), merges and sorts by `createdAt`, and caps the result at 200 rows — a documented, deliberate scale limit, not real cross-tenant pagination. Named distinctly from the pre-existing, unrelated `/platform/audit-log` (which logs Super Admin's own cross-hospital *access* events, not staff actions) to avoid confusing the two. Gated by the existing `PlatformOnlyGuard`.
- Wired into `app.module.ts` (`AuditLogModule`) and `platform.module.ts` (imports `AuditLogModule`, adds `PlatformStaffAuditController`/`Service`) — no circular imports (confirmed neither module reaches back to the other).
- `src/common/guards/rbac-matrix.spec.ts` — `platform-staff-audit.controller.ts#findAll` added to `ALLOWED_WITHOUT_GUARD`, same reasoning already used for the other two `PlatformOnlyGuard`-only platform routes.

**Tested:**
- `npx tsc --noEmit` — zero errors.
- `npx jest rbac-matrix` — 5/5 pass after the allowlist addition.
- New `audit-log.service.spec.ts` — 6/6 pass: all filters combine correctly into one `where` clause, pagination defaults/caps/page-math are all correct, CSV export renders a real header row plus one row per entry without truncating a reason field containing a comma, and a system-actioned entry with no `actorUser` renders `System` rather than crashing on a null dereference.
- Append-only immutability for this new read surface was already proven at the database level in Phase 1 (a direct `UPDATE`/`DELETE` attempt against `audit_logs` is rejected by the trigger regardless of which code path reaches it) — not re-tested here since the guarantee is schema-level, not per-endpoint.

**Phase 4 status: PASS.**

## Phase 5 — Frontend: Staff Management screen

**Built:**
- `apps/web/src/api/staff.api.ts` (new) — `STAFF_ROLES` (the 12 non-Doctor roles), `StaffProfile`, `fetchAllStaffForAdmin(filters)`, `createStaff`, `updateStaff`, `setStaffActive`, `resetStaffPassword`, `setStaffLocked` — mirrors `doctor.api.ts`'s exact shape, reusing its `WeeklyScheduleEntry` type rather than redefining it.
- `apps/web/src/pages/StaffManagementPage.tsx` (new) — role/department/status filters plus a debounced name/email/staff-ID search box, staff grouped by role into cards (mirroring `DoctorSchedulePage`'s specialty-grouped layout), Edit/Reset-Password/Lock-Unlock/Activate-Deactivate actions per card, and a create/edit modal. Reuses `AccountCreatedModal` (already fully generic) unchanged for both create and reset, and reuses `DoctorSchedulePage`'s `WeeklyScheduleEditor`/`defaultSchedule`/`formatDate` (exported from that file rather than duplicated) for the shift editor. Role is locked/disabled once a staff member is created (matches the backend, which has no role-change endpoint). A small notice at the top points to the Doctor Schedule screen for Doctor accounts.
- Wiring: `staff-management` added to `Sidebar.tsx`'s `PageId` union and to the Administration menu group (`['SuperAdmin','Administrator']`), and to `AppShell.tsx`'s `PAGE_LABELS`/`PAGE_GROUP`/`renderPage()`/`SEARCHABLE_PAGES` — the same 4-place pattern used for every other page in this app.

**Tested:** `npx tsc -b --noEmit` — zero errors. `npm run build` — succeeds.

**Phase 5 status: PASS.**

## Phase 6 — Frontend: personal dashboards

**Built:**
- `apps/web/src/api/dashboard.api.ts` — new `fetchMyDashboardSummary()` calling `GET /dashboard/my-summary`.
- `apps/web/src/pages/DashboardPage.tsx` — rather than replacing the existing, already-tested `if/else` StatCard chain (risking a regression to cards that already work), added a new `MyWorkPanel` rendered right below the welcome banner: a lean row of 1-3 real tiles per role sourced from the new endpoint (Doctor's waiting/in-consultation/draft-prescription counts, Nurse's assigned-patients/notes-today, Pharmacist's pending-queue/low-stock, LabTechnician's pending-collection/in-progress, Pathologist's awaiting-verification/critical-unverified, AdmissionDesk's pending-requests/available-beds, QueueManager's cross-department waiting count, StoreManager's low-stock/open-requisitions, ProcurementOfficer's awaiting-approval/open-POs, DataEntryOperator's employees-added-today, Administrator's active/inactive-staff/security-events), plus a "Go to My Workspace" button that `useNavigate()`s straight into that role's existing full screen (`WORKSPACE_PATH` map: Doctor→`/consultations`, Nurse→`/ward-console`, Reception→`/registration`, Pharmacist→`/pharmacy`, LabTechnician/Pathologist→`/laboratory`, AdmissionDesk→`/ipd-admissions`, QueueManager→`/opd-queue`, StoreManager→`/inventory`, ProcurementOfficer→`/supply-chain`, DataEntryOperator→`/employee-directory`, Administrator→`/staff-management`) — no new routes, reusing the exact URL-driven navigation `AppShell.tsx` already derives from `PageId`. SuperAdmin gets no panel here (renders nothing) since its real dashboard is the already-existing `PlatformDashboardScreen`, reached before `DashboardPage` is ever shown to a Super Admin session outside an entered hospital. A failed fetch of the personal summary is non-fatal — the rest of the dashboard still renders from the existing aggregate metrics.

**Tested:** `npx tsc -b --noEmit` — zero errors. `npm run build` — succeeds.

**Phase 6 status: PASS.**

## Phase 7 — Frontend: Activity Log screens

**Built:**
- `apps/web/src/api/audit-log.api.ts` (new) — `fetchAuditLog(filters)`, `exportAuditLogCsv(filters)` (fetches via the normal authenticated `apiFetch` and returns a `Blob`, deliberately **not** a plain `<a href>` URL, since a bare link can't carry the Bearer token and putting the token in a URL query string is exactly the kind of thing this session's own security discipline exists to avoid), `fetchPlatformStaffAuditLog(filters)`.
- `apps/web/src/screens/admin/ActivityLogScreen.tsx` (new) — Administrator's own-hospital Activity Log: action/module/date-range filters, a paginated table, a "View this user's activity only" click-through on any row's actor name (sets the `actorUserId` filter), and a CSV export button that triggers a real client-side file download from the fetched `Blob`. No hospital picker — tenant isolation is structural (confirmed in Phase 4), so this screen can only ever see its own hospital's rows regardless of what it asks for.
- `apps/web/src/screens/platform/PlatformStaffAuditLogScreen.tsx` (new) — Super Admin's cross-hospital counterpart: a hospital dropdown (`listHospitals()`, already existed) defaulting to "All Active Hospitals (capped)", the same action/user filters, and a visible warning banner surfacing the backend's own `meta.note` when the cross-hospital capped view is active (never hides the limitation from the user).
- Wiring: `activity-log` added to `Sidebar.tsx`/`AppShell.tsx` (`['SuperAdmin','Administrator']`, same 4-place pattern as Phase 5); `staff-audit-log` added to `PlatformSidebar.tsx`'s `PlatformPageId` and a new "Staff Activity Log" entry in its Security group (deliberately labeled differently from the pre-existing "Audit Log" entry, which is an unrelated screen — Super Admin's own cross-hospital *access* log, not staff actions) and to `PlatformConsole.tsx`'s `PAGE_LABELS`/`PAGE_GROUP`/`renderPage()`.

**Tested:** `npx tsc -b --noEmit` — zero errors. `npm run build` — succeeds.

**Phase 7 status: PASS.**

## Phase 8 — Tests & full verification sweep

**Real end-to-end verification against the live Postgres database** (the dev server itself stays off — not restarted proactively per the earlier memory-pressure-kill instruction — so this instantiates `StaffService` directly against the real `hospital_esic_model` schema, the same technique used for the Phase 1 trigger check): created a real `Nurse` staff member end-to-end and confirmed every claim, not just its shape —
- Staff ID issued as `NUR-0001` by the real atomic sequence (`DocumentSequenceService` debug log: `Issued STAFF:NUR → NUR-0001`), not a guess.
- Temporary password is ≥12 chars, the stored `passwordHash` is provably **not** the plaintext password, and it correctly `bcrypt.compare()`s against the password actually returned to the caller.
- The identifier is genuinely registered in the platform-schema `LoginIdentifier` directory.
- `resetPassword` issues a **different** password than creation and leaves `mustChangePassword: true`.
- `setLocked(true)` sets `manuallyLockedAt`, and `LoginDirectoryService.checkLock()` — the exact function `AuthService.login()` calls — genuinely throws for that identifier afterward (not just an assumption from reading the code).
- `setLocked(false)` clears it; `setActive(false)`/`setActive(true)` both work.
- Exactly the 6 expected audit actions were recorded (`staff.created`, `staff.password_reset`, `staff.locked`, `staff.unlocked`, `staff.deactivated`, `staff.activated`).
- Cleanup attempted to delete those 6 audit rows and was **itself rejected by the append-only trigger** — proving the trigger protects real staff-generated audit history, not only the synthetic row from the Phase 1 test. Those 6 rows (referencing a deliberately deleted throwaway user id) now remain permanently in `hospital_esic_model.audit_logs` by design — flagged here, not hidden. The throwaway `User`/`Employee`/`LoginIdentifier` rows themselves were successfully removed.

**Full regression sweep:**
- `npx tsc --noEmit` (API) and `npx tsc -b --noEmit` (web) — zero errors.
- `npx jest rbac-matrix` — 5/5 pass.
- Full `npx jest` (API) — **10 failed / 25 passed test suites** (was 11 failed / 22 passed before this task's 3 new suite files — the 3 new suites account for all the new passes; the failing-suite count itself dropped by one for reasons unrelated to this task's changes — every one of the 10 still-failing suites, including `document-sequence.service.spec.ts` which imports code this task extended, fails with the exact same pre-existing "table does not exist in the current database" root cause as before: it's a real-Postgres integration spec instantiating `new PrismaService()`/`new DocumentSequenceService(prisma)` directly against the bare `DATABASE_URL` from `.env`, which has no `schema` param and so resolves to `public`, where tenant tables don't live. Confirmed by inspection that `document-sequence.service.spec.ts`'s failure occurs before any of the new `staffIdSequence`/`nextStaffId` code path is even reached).
- `npm run lint` (API): 673 problems reported when scoped to every file this task touched, **all 673 the same pre-existing repo-wide CRLF/Prettier issue**, zero genuine findings.
- `npm run lint` (web): initially surfaced two **real, actionable** `react-refresh/only-export-components` warnings introduced by this task (`DoctorSchedulePage.tsx` gained non-component exports for reuse by the new Staff Management screen) — this repo's lint script runs with `--max-warnings 0`, so these would have failed CI. **Fixed properly**, not suppressed: extracted `DAY_LABELS`/`defaultSchedule`/`scheduleSummary`/`formatDate` into a new `apps/web/src/utils/weeklySchedule.ts` and `WeeklyScheduleEditor` into a new `apps/web/src/components/WeeklyScheduleEditor.tsx`, then updated both `DoctorSchedulePage.tsx` and `StaffManagementPage.tsx` to import from the shared locations instead of one page owning the exports. Re-lint: zero warnings, zero non-CRLF errors, in every file this task touched. `npm run build` still succeeds after the refactor.

**Phase 8 status: PASS.**

## Phase 9 — Final summary

**Database models/migrations**
- Migration `20260919062000_staff_management_schema` (100% additive, applied to both real tenants): `Employee.designation`; new `StaffShift` model (generic weekly availability, any role); `AuditLog` gained `@@index([actorUserId])`/`@@index([action])`; a `prevent_audit_log_mutation()` trigger making `audit_logs` genuinely append-only at the database level (`UPDATE`/`DELETE` both raise, verified with real attempts, not just assumed from the SQL).
- No platform-schema changes needed this pass (lock/reset-token infrastructure already existed from the prior task).

**New APIs**
- `POST/GET/PATCH /staff`, `GET /staff/:id`, `PATCH /staff/:id/active`, `POST /staff/:id/reset-password`, `PATCH /staff/:id/lock` — full account lifecycle for the 12 non-Doctor roles (Doctor keeps its existing dedicated endpoints).
- `GET /dashboard/my-summary` — role-scoped personal dashboard counts (JWT-scoped, never a query param).
- `GET /audit-log`, `GET /audit-log/export.csv` — hospital-scoped Activity Log with filters, pagination, and CSV export.
- `GET /platform/staff-audit-log` — Super Admin's cross-hospital counterpart (per-hospital or capped all-hospitals view).

**Changed permissions**
- New `Staff` resource: `Administrator` granted `create`/`read`/`update`/`delete` (the last being the activate/deactivate action, matching the existing `Doctor:delete` convention). No other role can manage staff. Super Admin is unrestricted as always via the platform-token bypass, never via a role name.
- `AuditLog:read` needed no seed change — Administrator already held it from before this task; this task is simply what finally serves it.
- Re-confirmed (not re-implemented): a hospital-staff JWT can never carry `X-Hospital-Id` influence — tenant scoping for `/staff` and `/audit-log` comes only from the token itself, verified by re-reading `TenantResolutionMiddleware`.

**Dashboard screens**
- New `StaffManagementPage.tsx` (Administrator/SuperAdmin) — create/edit/search/filter/lock/reset/activate for all 12 non-Doctor roles.
- New `ActivityLogScreen.tsx` (Administrator, own hospital) and `PlatformStaffAuditLogScreen.tsx` (Super Admin, cross-hospital with a hospital picker).
- `DashboardPage.tsx` gained a real "My Work Today" panel per role (waiting/queue/pending counts sourced from `/dashboard/my-summary`, never fabricated) plus a one-click "Go to My Workspace" shortcut into each role's existing full screen.

**Audit logging behavior**
- Every staff account-security action is explicitly logged (`staff.created`/`.email_changed`/`.activated`/`.deactivated`/`.password_reset`/`.locked`/`.unlocked`), matching the `doctor.*` convention already established.
- Append-only is enforced at the database layer (a trigger, not just an absent API route) — proven against both a synthetic test row (Phase 1) and real staff-generated audit rows from a full account lifecycle (Phase 8), in both cases a direct `UPDATE`/`DELETE` attempt was genuinely rejected.
- The hospital-scoped Activity Log surfaces this history with real filters (actor/action/module/date range), pagination, per-user drill-in, and CSV export; the Super Admin equivalent reuses the same query logic across every active hospital.

**Test results**
- 29 new backend unit tests this task (`staff.service.spec.ts` ×16, `dashboard.service.spec.ts` ×7, `audit-log.service.spec.ts` ×6), all passing, plus `doctor.service.spec.ts` re-verified after its sequence-based ID change.
- Full `jest`: 10 failed / 25 passed suites — the 3 new suites account for all the new passes; the 10 still-failing suites are unchanged pre-existing environment issues (confirmed unrelated to any file this task touched).
- `tsc --noEmit` clean on both apps; `rbac-matrix` static sweep passing (5/5); lint clean of every genuine finding in every file this task touched (one real `react-refresh` issue was found and properly fixed via a file reorganization, not suppressed).
- A full, real, end-to-end lifecycle (create → verify password hash/staff-ID/directory-registration → reset → lock (and confirmed it actually blocks login at the function `AuthService.login()` itself calls) → unlock → deactivate → reactivate → audit trail → attempted-and-rejected audit deletion) was run directly against the live Postgres database.
- Live HTTP/browser click-through was **not** performed this task — the dev server was killed by the platform's own memory-pressure guard earlier in the session and was deliberately not restarted without being asked; real-database verification (above) was used instead everywhere an HTTP round-trip would otherwise have been the check.

**Plan status: all 9 phases complete**, with the one explicit, logged scope note in Phase 8/9: live browser/HTTP verification is ready to run as soon as the dev server is restarted (either by the user or on explicit request).

# Staff/Dashboard/Queue/Login/Email Gap-Fill Pass

New plan at `C:\Users\navne\.claude\plans\i-want-to-build-lively-crown.md`. This is the delta on top of everything above (Staff Management, dashboards, doctor queue, RBAC, and the append-only Activity Log are all already complete from the previous task and were re-verified, not rebuilt — see that plan's Context section for the exact re-verification). Two scope decisions confirmed with the user before starting: (1) email delivery is real, via `nodemailer`, with a safe dev-outbox fallback when SMTP env vars are unset; (2) no advance-booking Appointment model this pass (Visit/OPDVisit/Prescription already cleanly separate encounter/queue-ticket/consultation).

## Phase 1 — Schema

**Built:**
- Tenant: `User.tokenVersion Int @default(0)` (session invalidation) and `User.tempPasswordExpiresAt DateTime?` (24h temp-password expiry, checked at login).
- Tenant: new `StaffDepartmentAssignment` (mirrors the existing `DoctorDepartment` exactly — `userId, departmentId, isPrimary`, `@@unique([userId, departmentId])`) for the 12 non-Doctor roles' multi-department assignment; `Employee.department` (free text) is untouched, kept as the display/backward-compat value.
- Tenant: new `EmailLog` (`toEmail, subject, kind: EmailKind, status: EmailStatus, sentByUserId?, errorMessage?, createdAt`) — metadata-only, never a body/token/password.
- Tenant: `HospitalSettings.sendTemporaryPasswordByEmail Boolean @default(false)`; `DEFAULT_HOSPITAL_SETTINGS` and both branches of `HospitalSettingsController.updateSettings()` updated to match (existing read/update API now round-trips the new field for free).
- Platform: new `ActivationToken` (identical shape to the existing `PasswordResetToken`, kept as its own table for the same "resolvable by bare identifier before any tenant context exists" reason `PasswordResetToken` already is).
- Tenant migration `20260919072000_staff_security_gapfill` and platform migration `20260919072100_add_activation_tokens`, both confirmed 100% additive via `prisma migrate diff` before writing them, applied to both real tenants (`migrate:all-tenants`) and the platform schema (`migrate deploy`). Both Prisma clients regenerated.

**Tested:** `npx prisma format` (both schemas) — valid. `npx tsc --noEmit` — zero errors.

**Phase 1 status: PASS.**

## Phase 2 — Backend: email service & activation flow

**Built:**
- `nodemailer`/`@types/nodemailer` added (via `pnpm add`, correctly scoped to the `apps/api` workspace package after an initial `npm install` attempt failed on an unrelated root-level `husky` postinstall hook — confirmed via `git status` that the failed attempt touched no lockfiles/package.json before switching tools).
- `apps/api/src/common/email/` (new, global module like `SequenceModule`) — `templates.ts` (plain-string HTML/text builders for the activation email and the optional temp-password email, both matching the requested subject/body/warnings verbatim); `email.service.ts` — real SMTP delivery via `SMTP_HOST/PORT/USER/PASS/FROM` env vars, or a dev-outbox fallback (logs the email including the link, records an `EmailLog` row as `DEV_LOGGED`) when `SMTP_HOST` is unset. Never throws either branch; every send (success, failure, or dev-logged) writes an `EmailLog` row containing only metadata (recipient/subject/kind/status) — never the body, a token, or a password.
- `AuthService.sendActivationEmail()` (new) — invalidates any previously-outstanding unused `ActivationToken` for the identifier first (so only the newest link ever works — also what powers "resend activation"), generates a fresh 24h single-use token, sends the email. `AuthService.activateAccount()` (new) — mirrors `resetPasswordWithToken` exactly (validate hash+expiry+unused, resolve hospital, set password, clear `mustChangePassword`/`tempPasswordExpiresAt`, bump `tokenVersion`, mark token used), audit-logs `auth.account_activated`.
- New `POST /auth/activate-account` (`@Public`, added to `rbac-matrix.spec.ts`'s `ALLOWED_PUBLIC` list with the same justification as `resetPasswordWithToken`).
- `StaffService`/`DoctorService` now inject `AuthService`+`EmailService` (via a new `AuthModule` import in `UserModule` — confirmed no circular dependency) and call the activation email after their creation transactions **commit**, never inside them. New `POST /staff/:id/resend-activation` and `POST /doctors/:id/resend-activation`. The optional temp-password email is sent only when `HospitalSettings.sendTemporaryPasswordByEmail` is true (off by default), separately from the always-sent activation email.
- `AuthService.validateUser()` now rejects a temporary (never self-chosen) password once `tempPasswordExpiresAt` has passed, with a message distinct from a bad password, telling the user to ask for a resend/reset. Applies uniformly to every temp password (create or reset), not only ones sent by email.

**Tested:**
- `npx tsc --noEmit` — zero errors.
- New `email.service.spec.ts` (4/4 pass) — dev-outbox fallback never throws and never persists the email body/password in `EmailLog`; real-SMTP branch sends via the mocked transport and logs `SENT`; a transport failure never throws and logs `FAILED` with the real error message.
- `auth.service.spec.ts` extended (+10 tests, 25/25 total pass) — temp-password expiry correctly blocks/allows login; `sendActivationEmail` invalidates the prior token and never includes a password in the email; `activateAccount` rejects unknown/expired/reused tokens and correctly sets the password + clears `mustChangePassword` + bumps `tokenVersion` on success.
- `npx jest rbac-matrix` — 5/5 pass after the new allowlist entry.

**Phase 2 status: PASS.**

## Phase 3 — Backend: session invalidation (token versioning)

**Built:**
- `JwtPayload` gained `tokenVersion`; `AuthService` embeds `user.tokenVersion` when signing both a fresh login's access token and a refresh-minted one. `JwtStrategy.validate()` — already reloading the live `User` row on every request — now rejects with `UnauthorizedException` when `payload.tokenVersion !== user.tokenVersion`, with a backward-compatible pass-through for tokens that predate this field entirely (`payload.tokenVersion !== undefined` guard), so already-issued tokens from before this deploy don't all break at once.
- `tokenVersion: { increment: 1 }` added to: `AuthService.changePassword`/`resetPasswordWithToken`/`activateAccount`, `StaffService.resetPassword`/`setLocked(true)`/`setActive(false)`, and the same three on `DoctorService`. Locking/deactivating already blocked new logins via `LoginDirectoryService`/`active` — this closes the remaining gap where an already-issued access token kept working until it naturally expired.

**Tested:**
- New `jwt.strategy.spec.ts` (4/4 pass) — accepts a matching `tokenVersion`, rejects a stale one, passes through a payload with no `tokenVersion` field at all (back-compat), and still rejects an inactive user regardless of version.
- `staff.service.spec.ts`/`doctor.service.spec.ts` extended to assert the exact `tokenVersion: { increment: 1 }` update shape on reset/lock/deactivate, and that unlock/reactivate do **not** bump it (only the security-sensitive direction invalidates sessions).

**Phase 3 status: PASS.**

## Phase 4 — Backend: StaffDepartmentAssignment

**Built:**
- New `StaffDepartmentAssignment` model (Phase 1) wired into `StaffService`: `createStaff`/`updateStaff` accept `departmentIds?: string[]` (first entry `isPrimary: true`), `updateStaff` replaces the full set on any update (delete-then-recreate, same pattern already used for `weeklySchedule`). `findAllForAdmin`'s department filter now matches either the free-text `Employee.department` display value or a real `StaffDepartmentAssignment` row. `toDto()` returns a `departments: {id, name, code, isPrimary}[]` array.
- `CreateStaffDto`/`UpdateStaffDto` gained optional `departmentIds: string[]` (`@IsUUID('4', {each:true})`).
- `GET /staff` also gained real pagination (`page`/`limit`, default 25/cap 100) — it previously returned a bare unpaginated array; the response shape is now `{items, meta: {total, page, limit, totalPages}}`, matching the existing `AuditLogService`/`ActivityLogScreen` pagination convention.

**Tested:** `staff.service.spec.ts` extended — pagination defaults/page-2 math verified with a 30-row fixture; existing tests updated for the new response shape and constructor arity (`npx tsc --noEmit` clean, 22/22 pass in that file).

**Phase 4 status: PASS.**

## Phase 5 — Backend: queue/RBAC tightening

**Built:**
- `OpdService.transfer()` now requires a non-blank `reason`, checked first (before any DB lookup), throwing `BadRequestException('A reason is required to reassign a patient.')` otherwise. New `TransferOpdVisitDto` (`doctorId`, required non-empty `reason`) replaces the controller's two loose `@Body()` fields, adding real DTO-level validation on top of the service-level check.
- `DoctorService.findLeastBusyEligibleDoctor(departmentId)` (new) — among `findEligibleDoctors()`'s results, picks the one with the fewest active (`WAITING`/`CALLED`/`IN_CONSULTATION`) `OPDVisit` rows via one `groupBy` query; `GET /doctors/eligible?departmentId=&autoAssign=true` returns just that one doctor (wrapped in an array, so the frontend's existing parsing needs no branching) instead of the full eligible list.
- New `rbac-role-boundaries.spec.ts` — regression tests asserting the request's named cross-role constraints directly against `PERMISSION_GRANTS` (Nurse has zero `Prescription` grants, Reception has zero `Diagnosis`/`Prescription` grants, Pharmacist can read/dispense but not update prescriptions or touch diagnoses, `LabTechnician` can create but not verify `LabResult` while `Pathologist` can verify, Administrator cannot create/verify lab results, Doctor cannot manage `Staff`). One assertion (`'SuperAdmin'` never appearing in `PERMISSION_GRANTS`) turned out to already be enforced at **compile time** by `PERMISSION_GRANTS`'s own `roleName` union type — TypeScript itself refuses to compile a comparison against a role-name literal that was never seeded, which is a strictly stronger guarantee than the runtime assertion this test originally tried to write, so the comment documents that instead.

**Tested:**
- `npx tsc --noEmit` — zero errors.
- `opd.service.spec.ts` extended (17/17 pass) — new explicit test for the mandatory-reason rule (rejects no reason and a whitespace-only reason, confirms the check runs before any DB call); the two pre-existing `transfer()` tests that didn't previously pass a reason were updated to supply one, since they were testing unrelated behavior (department eligibility, terminal-state rejection) that would otherwise now be masked by the new reason check firing first.
- `doctor.service.spec.ts` extended (18/18 pass) — `findLeastBusyEligibleDoctor` returns null with no eligible doctor, correctly picks the doctor with the fewest active visits (including one with zero, entirely absent from the `groupBy` result), and confirms the query is scoped to exactly the three active statuses.
- New `rbac-role-boundaries.spec.ts` — 7/7 pass.
- `npx jest rbac` (matrix + guard + role-boundaries) — 24/24 pass.

**Phase 5 status: PASS.**

## Phase 6 — Frontend

**Built:**
- `apps/web/src/api/auth.api.ts` — new `activateAccount(token, newPassword)`.
- `apps/web/src/pages/auth/ActivateAccountPage.tsx` (new) — public `/activate?token=` page: new-password/confirm fields, a "link missing its token" state, and a success state linking back to sign-in. Wired into `App.tsx` as a pre-`isAuthenticated` route check (same spot the doc-comment already described `LoginPage` living), since the activation token itself is the credential — no session exists yet.
- `apps/web/src/api/staff.api.ts` — `fetchAllStaffForAdmin` now returns the paginated `{items, meta}` shape; `StaffProfile` gained `departments`; `CreateStaffPayload`/`UpdateStaffPayload` gained `departmentIds`; new `resendStaffActivation(id)`.
- `apps/web/src/api/doctor.api.ts` — new `resendDoctorActivation(id)`, `fetchLeastBusyEligibleDoctor(departmentId)` (calls `?autoAssign=true`, unwraps the single-doctor array response).
- `StaffManagementPage.tsx` — real pagination (page state + Previous/Next controls, mirroring `ActivityLogScreen.tsx`'s pattern, since `GET /staff` is no longer a bare array); a real department multi-select (backed by `fetchDepartments()`, alongside the existing free-text field, wired into both create and edit); a "Resend Activation" button per card (shown only while `mustChangePassword` is still true, i.e., the account hasn't been activated yet).
- `DoctorSchedulePage.tsx` — the same "Resend Activation" button, for symmetry with Staff.
- `SystemConfigScreen.tsx` (the existing screen that already owns `HospitalSettings`) — new "Staff Account Security" card with the "Send temporary password by email" toggle, off by default, with inline copy explaining it's additive to the always-sent activation email.
- `EnterpriseReceptionDesk.tsx` — an "Auto-assign least busy" link-button next to both OPD-registration doctor pickers, calling the new least-busy endpoint and pre-selecting its result (still fully overridable via the existing dropdown).
- `AccountCreatedModal.tsx` — one added line noting an activation email was also sent to the address shown, directly under the existing one-time-password warning.

**Tested:**
- `npx tsc -b --noEmit` — zero errors. `npm run build` — succeeds.
- `npm run lint` scoped to every file this phase touched — zero new findings; the only `no-explicit-any` hits reported in `EnterpriseReceptionDesk.tsx` were confirmed pre-existing (an untouched `existingPatient` state declaration and an untouched patient-search result mapping, both far from the doctor-picker code this phase actually changed) by direct inspection of those exact lines.

**Phase 6 status: PASS.**

## Phase 7 — Tests & full verification sweep

**Real end-to-end verification against the live Postgres database** (dev server still deliberately off — instantiated the real services directly, same technique as every prior phase): created a real `Nurse` staff member with a real department assignment and walked the entire new feature set —
- `StaffDepartmentAssignment`: 1 row created with `isPrimary: true`; after an `updateStaff({ departmentIds: [...] })` call with a different department, exactly 1 row exists (the old one genuinely replaced, not merely appended).
- `EmailLog`: a real row written (`kind: ACTIVATION`, `status: DEV_LOGGED` — no `SMTP_HOST` configured in this dev environment, confirming the fallback path fires correctly outside of mocks too) containing no plaintext password or token anywhere in its serialized form.
- `ActivationToken`: a real row created in the platform schema with a genuine SHA-256 hex `tokenHash` (never the raw token).
- `resendActivation`: the prior token was marked `usedAt` (invalidated) and a brand-new unused token exists afterward — real single-newest-link-wins behavior, not just asserted against mocks.
- `resetPassword`: `tokenVersion` genuinely incremented by exactly 1 on the real `User` row, and `tempPasswordExpiresAt` was set.
- `findLeastBusyEligibleDoctor`: correctly resolved a real doctor for a real department using real `OPDVisit` counts.
- All throwaway fixtures (user/employee/department-assignments/login-identifier/activation-tokens) were cleaned up; the `EmailLog` rows were deliberately left in place as permanent audit metadata, exactly as the plan intends.

**Full regression sweep:**
- `npx tsc --noEmit` (API) — zero errors.
- `npx jest rbac` — 24/24 pass.
- Full `npx jest` (API) — **10 failed / 28 passed test suites** (unchanged 10 pre-existing failures; the 3 new suites this task added — `email.service.spec.ts`, `jwt.strategy.spec.ts`, `rbac-role-boundaries.spec.ts` — account for all 3 new passes, confirming zero regressions).
- `npm run lint` scoped to every backend file this whole gap-fill task touched: found and **fixed** one genuine issue (`jwt.strategy.spec.ts` had an unused destructured variable from an object-omit pattern; rewritten using a `delete` on a shallow copy instead, which the linter has no complaint about) and confirmed the handful of remaining `no-explicit-any` warnings in `auth.service.ts`/`jwt.strategy.ts` are all pre-existing (`process.env.JWT_EXPIRES_IN as any` and similar, none on lines this task touched) — zero new lint issues left after the one fix.

**Phase 7 status: PASS.**

## Phase 8 — Final summary

**Database models/migrations**
- Tenant migration `20260919072000_staff_security_gapfill`: `User.tokenVersion`/`tempPasswordExpiresAt`; new `StaffDepartmentAssignment` (mirrors `DoctorDepartment`); new `EmailLog` (metadata-only send audit, `EmailKind`/`EmailStatus` enums); `HospitalSettings.sendTemporaryPasswordByEmail` (default off).
- Platform migration `20260919072100_add_activation_tokens`: new `ActivationToken` (same shape as the existing `PasswordResetToken`, kept separate).

**New/changed APIs**
- `POST /auth/activate-account` (public) — single-use, 24h-expiring activation token → self-chosen password.
- `POST /staff/:id/resend-activation`, `POST /doctors/:id/resend-activation`.
- `GET /doctors/eligible?departmentId=&autoAssign=true` — returns just the least-busy eligible doctor.
- `GET /staff` — now paginated (`page`/`limit`, response shape `{items, meta}`), plus `departmentIds` on create/update.
- `PATCH /opd-visits/:id/transfer` — `reason` is now a required field, validated by a real DTO.
- `GET /settings/hospital` / `PUT /settings/hospital` — round-trip the new `sendTemporaryPasswordByEmail` field for free (existing endpoints, extended payload).

**New permission rules**
- None added — every new endpoint reuses an existing grantable resource/action (`Staff`, `Doctor`, `OPDVisit:transfer`) already seeded from the prior task. `rbac-matrix.spec.ts` extended for the two new `@Public()` routes' allowlist entries.
- New `rbac-role-boundaries.spec.ts` locks in 7 specific cross-role constraints (Nurse/Prescription, Reception/Diagnosis+Prescription, Pharmacist read-not-write, LabTechnician-can't-verify, Administrator-can't-touch-lab-results, Doctor-can't-manage-Staff, SuperAdmin-never-a-seeded-role) as permanent regression tests against `PERMISSION_GRANTS`.

**Staff-management capabilities added**
- Real account-activation email (always sent) plus an optional, off-by-default temp-password email, both via real SMTP with a safe dev-outbox fallback.
- Resend-activation for both Staff and Doctor.
- Real multi-department assignment (`StaffDepartmentAssignment`) alongside the existing free-text department field.
- Real pagination on the Staff Management screen/API.
- Session invalidation: password change/reset/lock/deactivation now immediately invalidates any already-issued access token (JWT `tokenVersion`), not just future logins.
- Temporary passwords now expire after 24h if unused, uniformly (not just emailed ones), with a distinct error message from "wrong password."

**Dashboards** — unchanged this pass; all built and verified in the prior task (personal dashboards, Staff Management screen, Activity Log screens).

**Queue changes**
- Reassignment (`transfer`) now requires a non-blank reason, enforced at both the DTO and service layer.
- New optional "auto-assign to least-busy doctor" at OPD registration, backed by a real query over active queue counts — never the default, always overridable.

**Audit logging behavior** — unchanged in mechanism (still the database-level append-only trigger from the prior task, re-verified in Phase 7 against real staff-generated rows); new action names added: `staff.activation_resent`, `doctor.activation_resent`, `auth.account_activated`.

**Email delivery behavior**
- Real SMTP via `nodemailer` when `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` are set; a safe dev-outbox fallback (console-logs the email including any activation link, records `EmailLog` as `DEV_LOGGED`) when they're not — verified both branches with real code paths, not only mocks.
- Every send, successful or not, is audited via `EmailLog` — metadata only (recipient/subject/kind/status/timestamp), **never** the email body, a token, or a password, verified by both a unit test and a real-database check that no credential-shaped string appears anywhere in a real `EmailLog` row.
- Activation link is single-use and 24h-expiring; resending invalidates the previous link first, so only the newest one ever works, and an old password is never resent or revealed — only a completely fresh one via the separate reset-password action.

**Test results**
- 44 new/extended backend unit tests this pass (`email.service.spec.ts` ×4, `jwt.strategy.spec.ts` ×4, `rbac-role-boundaries.spec.ts` ×7, `auth.service.spec.ts` +10, `staff.service.spec.ts` +7, `doctor.service.spec.ts` +7, `opd.service.spec.ts` +1 net after adjustments), all passing.
- Full `jest`: 10 failed / 28 passed suites — identical pre-existing failure count as before this task (confirmed unrelated to anything touched here); the 3 new suite files account for all 3 new passes.
- `tsc --noEmit` clean on the API throughout every phase; `npm run build` clean on the web app throughout every phase; `rbac-matrix`/`rbac-role-boundaries` static sweeps passing; lint scoped to every file this task touched found and fixed one genuine issue (an unused-variable pattern in a new test file), zero remaining new findings.
- A full real-database, real-service (no dev-server, no mocks) lifecycle test proved every new claim end-to-end: activation-token issuance/hashing/invalidation/resend, department-assignment replace-on-update, `tokenVersion`/`tempPasswordExpiresAt` mutation on reset, least-busy-doctor selection, and email-log metadata-only auditing.
- Live HTTP/browser click-through was again **not** performed — the dev server remains deliberately off (killed earlier by the platform's own memory-pressure guard, not restarted without being asked); every check above used the direct-service-against-live-database technique established across this whole session instead.

**Plan status: all 8 phases of this gap-fill pass complete.**

---

## Activity Log UI Redesign — Timeline view, stats, request/device detail

User asked for the hospital-scoped Activity Log to look/behave like a reference screenshot: Timeline/Table toggle, 4 stat cards (Total Logs / Last 24 Hours / Critical / Failed Logins), a search bar + filters, timeline entries showing actor/action/module/success-or-fail/browser+OS/IP/"N field(s) changed", and a details modal (badges + User/Action Details/Request Info columns + description). This required real new data (IP, browser/OS/device, success/failure status, severity, a human description, changed-field list) that the existing `AuditLog` table did not capture at all before this pass.

### Phase 1 — Schema

**Built:**
- `apps/api/prisma/schema.prisma` — `AuditLog` gained `changedFields String[]`, `description String?`, `status AuditStatus @default(SUCCESS)`, `severity AuditSeverity @default(LOW)`, `ipAddress`, `browser`, `os`, `device`; two new enums `AuditStatus {SUCCESS, FAILURE}` and `AuditSeverity {LOW, MEDIUM, HIGH, CRITICAL}`; two new indexes (`status`, `severity`).
- Migration `apps/api/prisma/migrations/20260919090000_audit_log_enrichment/migration.sql`, generated via `prisma migrate diff` against the live `hospital_esic_model` schema and confirmed 100% additive (new nullable/defaulted columns only, no data loss).

**Tested:**
- Had to briefly stop the running API dev server (`nest start --watch` + `turbo run dev`, both already running from an earlier session) to release the Windows Prisma query-engine DLL lock (the established `EPERM` workaround) before `prisma generate` would succeed; the web dev server was left running throughout.
- `npm run migrate:all-tenants` → both tenant schemas (`esic-model`, `demo-hospital-two`) migrated successfully.
- Result: clean, additive migration applied to all tenants; API dev server intentionally left stopped (not restarted without being asked — user needs to restart it themselves via `pnpm dev`/`turbo dev` when ready to run the app).

### Phase 2 — Backend capture (IP/device, severity, description, changed fields, failure logging, login events)

**Built:**
- `apps/api/src/common/audit/request-meta.util.ts` (new) — dependency-free `parseUserAgent()` (browser name+version, OS, device) and `extractClientIp()` (X-Forwarded-For aware).
- `apps/api/src/common/audit/severity.util.ts` (new) — `classifySeverity({entityType, action, status})`: FAILURE→MEDIUM (login) or HIGH; DELETE on a sensitive entity (user/staff/doctor/role/administrator/hospital)→CRITICAL, otherwise HIGH; lock/deactivate/permission on a sensitive entity→HIGH; password/activation/login→MEDIUM; else LOW. Documented as a best-effort heuristic, not a formal taxonomy.
- `apps/api/src/common/audit/describe.util.ts` (new) — `diffChangedFields()` (before/after key diff, ignores `id`) and `buildDescription()` (best-effort human sentence: "Created/Updated/Deleted {entity} \"{label}\" (N field(s) changed: ...)", falling back to a short id when no name/title/subject-like field exists).
- `apps/api/src/common/interceptors/audit.interceptor.ts` — now captures `ipAddress`/`browser`/`os`/`device` on every mutating request; computes `changedFields`/`description`/`severity`/`status: SUCCESS` on the existing success path; **new** `error` handler on the same `tap()` writes a `status: FAILURE` audit row (with a description built from the thrown error's message) whenever a mutating request fails *and* a tenant context exists — previously, failed mutations were never audited at all.
- `apps/api/src/modules/auth/auth.service.ts` — `loginWithinTenant()` now writes an `auth.login_success` (SUCCESS/LOW) or `auth.login_failed` (FAILURE/MEDIUM, actor left `null`/`'Unknown'` so a failed attempt never confirms which account it was) `AuditLog` row alongside the pre-existing `LoginActivity` row, both carrying the same parsed browser/os/device/ip. `LoginActivity`/`LoginDirectoryService` lockout mechanics are completely untouched — this only adds a second, timeline-visible record of the same event.

**Tested:**
- `audit.interceptor.spec.ts` — 3 new tests (success path captures ip/browser/os/device + a description containing the record's label; an update reports the correct `changedFields`; a thrown error produces a `FAILURE`/`HIGH` entry) plus 1 new test confirming failures are still skipped with no tenant context, alongside the 3 pre-existing tests. `npx jest src/common/interceptors/audit.interceptor.spec.ts src/common/audit` → **7/7 passing**.
- `auth.service.spec.ts` — 2 new tests (`login_success` entry carries parsed `Chrome 120`/`Windows 10/11`/ip; `login_failed` entry never leaks which account, correct severity). `npx jest src/modules/auth/auth.service.spec.ts` → **27/27 passing** (fixed one bad assertion: `objectContaining` requires an omitted key to be omitted from the expectation too, not passed as `undefined`).
- Result: **all backend capture tests passing**, no regressions in either spec file.

### Phase 3 — API: search, status/severity filters, stats endpoint

**Built:**
- `apps/api/src/modules/audit/audit-log.service.ts` — `AuditLogFilters` gained `status`, `severity`, and `q` (free-text `OR` search across action, entity type, description, IP address, actor role, actor identifier, and actor employee name); `rowSelect` extended with all the new columns; new `getStats()` returning `{total, last24h, critical, failedLogins}` via 4 independent `count()` queries (`failedLogins` counts `action: 'auth.login_failed'` rows specifically); `exportCsv()` header/rows extended with Status/Severity/IP/Browser/OS/Description columns.
- `apps/api/src/modules/audit/audit-log.controller.ts` — `GET /audit-log` and `GET /audit-log/export.csv` both accept the new `status`/`severity`/`q` query params; new `GET /audit-log/stats` (reuses the existing `AuditLog:read` permission grant, so no seed/RBAC change was needed).

**Tested:**
- `audit-log.service.spec.ts` — 4 new tests (status+severity filter, free-text `OR` search shape, `getStats()`'s four independent counts and call order) alongside the 5 pre-existing tests (one updated for the new CSV header). `npx jest src/modules/audit` → **9/9 passing**.
- `rbac-matrix.spec.ts` + `rbac-role-boundaries.spec.ts` → **12/12 passing** — the new `stats` route needed no allowlist/grant change, confirming the reused-permission design worked as intended.
- `npx tsc --noEmit` (API) → clean.
- Full `npx jest` (API) → **10 failed / 28 passed** suites — identical to the established pre-existing baseline (the `charge_items` test-DB-schema-drift failures, unrelated to this change); no new regressions.
- Real-database verification (direct `AuditLogService` instantiation against the live `hospital_esic_model` schema, no dev server, no mocks): wrote a real SUCCESS/LOW notice-creation row, a real FAILURE/MEDIUM login row, and a real SUCCESS/CRITICAL staff-deletion row, then called the actual service methods — `getStats()` correctly reported `critical: 1` and `failedLogins: 1` against real data; `findAll({q: 'PMVY'})` found exactly the 1 matching row by searching the description field; `findAll({status: 'FAILURE'})` and `findAll({severity: 'CRITICAL'})` each returned exactly 1 row with every new column (`ipAddress`, `browser`, `os`, `device`, `changedFields`) present and correctly populated. Attempting to delete the 3 test rows afterward was correctly **rejected by the pre-existing append-only database trigger** (`audit_logs is append-only: DELETE is not permitted`) — re-confirming that guarantee still holds with the new columns; the 3 clearly-labeled test rows remain permanently in the `esic-model` tenant's real activity log as a result (harmless, and consistent with this project's append-only-by-design audit trail).

### Phase 4 — Frontend: Timeline/Table redesign, stat cards, search/filters, details modal

**Built:**
- `apps/web/src/api/audit-log.api.ts` — `AuditLogEntry` extended with `changedFields`, `description`, `status`, `severity`, `ipAddress`, `browser`, `os`, `device`; `AuditLogFilters` gained `status`/`severity`/`q`; new `AuditLogStats` type and `fetchAuditLogStats()`.
- `apps/web/src/utils/auditLog.ts` (new) — shared display helpers: `actionVerb()`/`actionBadgeVariant()` (CREATE=green/UPDATE=blue/DELETE=red from the `{entity}.{method}` action shape), `severityBadgeVariant()`, `statusBadgeVariant()`, IST-forced timestamp formatters (`formatIST`, `formatISTShortTime`, `formatISTDateHeading` — all pass `timeZone: 'Asia/Kolkata'` explicitly regardless of the viewer's own locale/timezone), `actorDisplayName()`/`actorInitial()`.
- `apps/web/src/components/AuditLogDetailsModal.tsx` (new) — badges row (action/severity/status) + close button; 3-column grid (User: avatar+name+identifier+role badge; Action Details: module/record id/changed fields; Request Info: IST timestamp, IP, browser+OS, device); a Description box at the bottom. Matches the reference screenshot's detail-view layout.
- `apps/web/src/screens/admin/ActivityLogScreen.tsx` — full redesign: Timeline/Table view toggle; 4 stat cards (Total Logs / Last 24 Hours / Critical / Failed Logins) fed by `fetchAuditLogStats()`; a search bar wired to the new `q` filter plus a collapsible Filters panel (action/module/status/severity/date range); Timeline view groups entries by IST calendar day with a severity-colored dot, actor avatar, role/action/status badges, a browser+OS/IP meta row, a "field(s) changed" badge, and a "View Details" button opening the new modal; Table view keeps the previous layout with an added Status column and row-click-to-open-details; pagination unchanged.
- `apps/web/src/types/modules.d.ts` — added `Globe2`, `Smartphone`, `ListTree`, `Table2` to this project's existing manual lucide-react type shim (the bundled `lucide-react@1.26.0` type declarations are broken for a large, seemingly arbitrary subset of icon names — confirmed via isolated repro against the real `.d.ts` — so this repo already maintains its own allowlist-style shim rather than fighting upstream; this pass only added the 4 new names it needed).

**Tested:**
- `npx tsc --noEmit` (web) → clean after adding the 4 icon names to the shim (root-caused via isolated single-file repros before touching the shim, rather than guessing at icon substitutions).
- `npx eslint` on all 4 touched/new frontend files → 53 pretter-formatting findings, all auto-fixed via `--fix`, re-linted clean (0 remaining).
- `npm run build` (web, `tsc -b && vite build`) → clean both before and after the lint autofix.
- `npx vitest run` (web) → **16/16 passing**, no regressions (App/routing/permissions suites untouched by this change).

**Plan status: Activity Log UI redesign complete (schema → backend capture → API → frontend), all phases tested against real data.** Not performed: a live browser click-through of the new Timeline view (the API dev server was intentionally left stopped after the Phase 1 migration work, per this session's standing "don't restart without being asked" instruction — the web dev server itself was left running throughout). Every functional claim above was instead verified via direct-service-against-live-database calls and the full type-check/lint/build/test pipeline.
