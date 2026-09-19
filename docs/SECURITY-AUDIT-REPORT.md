# Security Audit Report — ESIC Hospital Management System

**Date:** 2026-09-19
**Scope:** Full-codebase authorized security review (`apps/api` NestJS/Prisma backend, `apps/web` Vite/React frontend, Docker/deployment config)
**Method:** Static code review (read-only). No code was modified, no data was altered, no destructive or live exploitation was performed. Findings were independently verified against actual source/config, not assumed.

---

## Executive Summary

Overall posture: **the multi-tenant schema-per-tenant architecture and the RBAC framework are both well-designed and mostly correctly enforced** — this is a system built with real security intent (per-request AsyncLocalStorage tenant routing, a Prisma-proxy that makes cross-tenant queries structurally hard to write by accident, an automated static test — `rbac-matrix.spec.ts` — that fails CI if any controller route is left without an explicit auth decorator, atomic concurrency control on bed allocation/document numbering/registration, and workflow-locking enforced in the service layer, not just via decorators).

Against that foundation, this audit found **one Critical finding that undermines everything else if it is ever triggered by a deployment misconfiguration**: hardcoded fallback JWT secrets baked into source code, used whenever the real secret environment variables are unset. Because the tenant-resolution middleware trusts `schemaName` directly from the JWT payload, and platform-type tokens bypass the RBAC guard entirely, a forged token signed with the (publicly visible, in this repo) fallback secret would grant full cross-tenant / Super-Admin-equivalent access. This is a "single point of total failure" finding — likely not currently exploitable (the real `.env` on disk has proper secrets set), but there is no fail-fast check to prevent it from becoming exploitable the moment any deployment (a new environment, a redeployed container, a Vercel project without the env var configured) is missing those three variables.

Beyond that, the audit found a cluster of High-severity issues spread across authorization granularity (a permission used for patient identity lookups also exposes full clinical history to front-desk roles), input validation (a TypeScript typing gap that silently disables the global validation pipe on one employee-update endpoint), concurrency (a real stock-count race in pharmacy dispensing), data exposure controls (unbounded CSV exports, no rate limiting, audit logs capturing plaintext temporary passwords), and infrastructure hardening (root containers, unguarded destructive DB scripts, tokens in localStorage).

No cross-tenant data leak was found in the tenant-isolation mechanism itself — that part of the system held up under close review.

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 12 |
| Medium | 9 |
| Low | 7 |
| Informational | 6 (plus positive/confirmed-safe controls listed in §Detailed Findings) |

---

## Architecture Understanding

- **Backend:** NestJS 10 + Prisma 5.22 ORM on PostgreSQL. Deployed today as a single Vercel serverless function (`apps/api/vercel.json`, catch-all route → `index.js`); a migration off serverless to a long-lived process is already planned by the team (see project memory) specifically because of tenant-connection-pool cold-start risk.
- **Frontend:** Vite + React 18, React Router 6. Talks to the API via `VITE_API_URL`; no server-side rendering.
- **Multi-tenancy model:** **Schema-per-tenant.** Each hospital gets its own Postgres schema (`hospital_<slug>`), created/dropped via validated, allowlist-checked DDL (`$executeRawUnsafe` guarded by a `SCHEMA_NAME_RE` regex — confirmed safe, no injection path). A separate "platform" schema (`public`) holds `Hospital`, `PlatformUser`, and `PlatformAuditLog` records for the single global Super Admin tier (there is intentionally only one platform-user role — no `role` column exists on `PlatformUser`).
- **Tenant routing:** `TenantResolutionMiddleware` runs before all guards, lightly decodes the caller's JWT to get either `{hospitalId, schemaName}` (hospital-staff token) or `{platformUserId}` (platform token, requiring an `x-hospital-id` header to select a target hospital, with an `ACTIVE` status check and an audit-log write). It then resolves a schema-scoped `PrismaClient` via `TenantClientFactory` (an LRU cache of per-schema clients, schema selected via a `?schema=` connection-string parameter — safely escaped by `URLSearchParams`, never raw SQL) and wraps the rest of the request in an `AsyncLocalStorage` context. The app's injected `PrismaService` is actually a `Proxy` that transparently forwards to `getTenantContext().prismaClient` — making it architecturally difficult for any service to accidentally query the wrong tenant.
- **Auth:** Two independent JWT flows — hospital-staff (`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`) and platform (`JWT_PLATFORM_SECRET`) — both HS256, validated by Passport strategies that re-check the user against the DB (`active`, `tokenVersion`) rather than trusting the JWT payload for permissions. Passwords hashed with bcrypt (cost 10). Password-reset tokens are cryptographically strong, hashed at rest, single-use, short-lived.
- **Authorization:** A single `RbacGuard` reads `@Roles(...)`/`@RequirePermission(resource, action)` decorators; platform-type tokens bypass all checks (by design — the one global Super Admin). An automated spec (`rbac-matrix.spec.ts`) statically parses every controller and fails if any route lacks an explicit auth decorator or an allow-listed reason — a genuinely strong structural control, and its own commit history shows it already caught a real bug (`GET/POST /doctors` once being accidentally `@Public()`).
- **File storage:** No file-upload subsystem exists yet (no multer, no object storage wiring beyond commented-out placeholder env vars) — several audit categories (file IDOR, upload validation) are currently not applicable, but should be revisited when this ships.
- **Cache/queue:** Redis is provisioned in `docker-compose.yml` but not used anywhere in `apps/api/src` yet.
- **WebSockets:** None present.
- **Rendering:** Server-side PDF/receipt generation via a shared, long-lived Puppeteer browser instance (`document-render.service.ts`), with an `escapeHtml()` helper applied almost everywhere it interpolates user data into templates.
- **Deployment:** Docker Compose for local dev (Postgres, Redis, api, web); Dockerfiles for both apps; no dedicated production compose/Dockerfile was found.

---

## Vulnerability Summary

| ID | Severity | Vulnerability | Component | Status |
|---|---|---|---|---|
| V-01 | Critical | Hardcoded fallback JWT secrets (access/refresh/platform), no startup validation | Auth / Tenant routing | Confirmed |
| V-02 | High | Refresh tokens never rotated, not bound to `tokenVersion`, no logout endpoint revokes them | Auth | Confirmed |
| V-03 | High | CORS enabled with no origin restriction (`enableCors()` defaults) | API / main.ts | Confirmed |
| V-04 | High | No global rate limiting (login partially mitigated; reports/exports/PDF unlimited) | API-wide | Confirmed |
| V-05 | High | Unbounded CSV report exports (full table dump) + CSV/Excel formula injection | Reports module | Confirmed |
| V-06 | High | Overbroad `Employee:read` permission exposes full clinical history to non-clinical roles | Patient module / RBAC | Confirmed |
| V-07 | High | Mass assignment on `PUT /employees/:id` — `Partial<Dto>` silently bypasses global ValidationPipe | Employee module | Confirmed |
| V-08 | High | Pharmacy stock dispense — non-atomic read-modify-write race (lost update) | Pharmacy module | Confirmed |
| V-09 | High | Plaintext temporary password persisted verbatim into audit log | Staff module / Audit interceptor | Confirmed |
| V-10 | High | Docker containers run as root (no `USER` directive) | Docker | Confirmed |
| V-11 | High | Destructive DB scripts have no environment guard against targeting production | DB scripts | Confirmed |
| V-12 | High | JWT + full user profile stored in browser `localStorage` (XSS-exfiltration exposure) | Frontend auth | Confirmed |
| V-13 | Medium | Suspended hospital's already-issued staff JWTs/refresh tokens remain valid | Tenant lifecycle | Confirmed |
| V-14 | Medium | CSRF "protection" middleware is non-functional (self-issues and self-validates) | API middleware | Confirmed |
| V-15 | Medium | Audit interceptor stores full unredacted request/response bodies for all mutating endpoints | Audit logging | Confirmed |
| V-16 | Medium | Unvalidated branding endpoint (`body: any`) allows CSS/script injection into shared PDF renderer | Branding / rendering | Confirmed |
| V-17 | Medium | Seed script uses predictable per-role passwords (`<Role>Pass123!`) | Prisma seed | Confirmed |
| V-18 | Medium | No idempotency key on charge-creation endpoints | Billing module | Likely |
| V-19 | Medium | Dev docker-compose binds Postgres/Redis to `0.0.0.0` instead of loopback | Docker | Confirmed |
| V-20 | Medium | Latent `Partial<Dto>`-erases-to-`Object` pattern also in benefit-rule/prescription/hospital-settings endpoints | Multiple modules | Confirmed (currently mitigated) |
| V-21 | Medium | No automated e2e test asserts cross-tenant isolation | Test coverage | Confirmed |
| V-22 | Low | Hardcoded local dev DB/Redis credentials in `docker-compose.yml` | Docker | Confirmed (dev-scope) |
| V-23 | Low | Missing `Referrer-Policy`/`Permissions-Policy`; coarse single-directive CSP | Security headers | Confirmed |
| V-24 | Low | `patient.photoUrl` accepts unbounded/unvalidated base64 string | Patient module | Confirmed |
| V-25 | Low | Minor DTO validation gaps (e.g. `DispenseMedicineDto` missing `@IsPositive()`) — already blocked at service layer | Pharmacy module | Confirmed, low impact |
| V-26 | Low | `GET /users` guarded by an unrelated permission name | User module | Confirmed |
| V-27 | Low | No global JSON body-size limit configured | API config | Confirmed |
| V-28 | Low | Minor connection-leak race on concurrent first request for a brand-new tenant schema | Tenant client factory | Confirmed, resource-leak only |
| I-01 | Informational | No field-level encryption for PII/medical data at rest (plaintext columns) | Database | Informational |
| I-02 | Informational | Floating Docker base image versions; mixed dependency pinning strategy | Dependencies | Informational |
| I-03 | Informational | Legacy comment references a retired role-based SuperAdmin bypass; recommend checking for leftover wildcard permission rows | RBAC | Informational |

---

## Detailed Findings

### V-01 — Hardcoded Fallback JWT Secrets Enable Full Auth Bypass

**Severity:** Critical **Confidence:** Confirmed
**Affected Component:** Authentication / Tenant resolution
**Affected Files:**
- `apps/api/src/modules/auth/auth.service.ts` (lines ~250-251, 255, 303-304, 333, 599-600)
- `apps/api/src/modules/auth/strategies/jwt.strategy.ts` (line ~33)
- `apps/api/src/modules/auth/strategies/platform-jwt.strategy.ts` (line ~19)
- `apps/api/src/common/middleware/tenant-resolution.middleware.ts` (lines ~84, 99)

**Description**
Every place the application signs or verifies a JWT falls back to a hardcoded literal secret if the corresponding environment variable is unset:
```
secret: process.env.JWT_ACCESS_SECRET   || 'dev_jwt_access_secret_key_12345'
secret: process.env.JWT_REFRESH_SECRET  || 'dev_jwt_refresh_secret_key_67890'
secret: process.env.JWT_PLATFORM_SECRET || 'dev_jwt_platform_secret_key_platform'
```
These three literals appear in **9 separate call sites**. `.env.example` documents the variables as `CHANGE_ME_IN_PRODUCTION`, but nothing in `main.ts` or anywhere else validates at startup that a real value was actually set — the app boots and serves traffic normally either way, with no warning logged.

This is compounded by two design facts that raise the blast radius from "one forged user session" to "total system compromise":
1. `TenantResolutionMiddleware` takes `schemaName` **directly from the JWT payload** for hospital-staff tokens, with no independent re-validation against the platform database, and uses it to select which Postgres schema the entire request operates against.
2. `RbacGuard` gives **any** token of `type === 'platform'` an unconditional bypass of all role/permission checks (`if (user.type === 'platform') return true`) — this is correct by design for the one legitimate global Super Admin, but it means a forged platform token is a full skeleton key across every hospital.

**Evidence**
```ts
// auth.service.ts
const accessToken = this.jwtService.sign(payload, {
  secret: process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_key_12345',
  expiresIn: (process.env.JWT_EXPIRES_IN as any) || '8h',
});
```
Confirmed (via `.env` inspection, not printed) that the real local `.env` currently has proper values set — this is not actively exploited in the current environment, but the code path exists unconditionally.

**Attack Scenario**
If a deployment (a new hospital's environment, a redeployed container, a Vercel project, a CI/staging environment) is ever missing `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, or `JWT_PLATFORM_SECRET`, anyone with read access to this source tree (the exact hardcoded value) can craft a JWT client-side:
```
{ type: 'platform', sub: '<any-uuid>', ... } signed with 'dev_jwt_platform_secret_key_platform'
```
Passport's `PlatformJwtStrategy.validate()` does re-check `sub` against a real, active `PlatformUser` row — so the attacker still needs a valid platform-user UUID (obtainable via enumeration, a leaked audit log, social engineering, or another vulnerability) — but once matched, this grants unconditional cross-tenant access to every hospital's data via the `x-hospital-id` header. A forged hospital-staff token is similarly bounded by needing a real user UUID in that schema, but critically, the `tokenVersion` revocation check is skipped entirely if the forged payload simply omits that field.

**Impact:** Complete authentication bypass, full multi-tenant data exposure, effective Super Admin impersonation.

**Root Cause:** Insecure-by-default fallback values committed to source control, with no fail-fast startup validation.

**Recommended Fix**
1. Remove all hardcoded fallback secret literals.
2. At application bootstrap (`main.ts`), validate that `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `JWT_PLATFORM_SECRET` are set and are not equal to the placeholder string `CHANGE_ME_IN_PRODUCTION` (or any known-weak value) — throw and refuse to start otherwise, in every environment except a clearly-marked local test mode.
3. Consider using `@nestjs/config` with a Joi/Zod schema to centralize this kind of startup validation for all required secrets.

**Additional Hardening:** Rotate all three secrets now as a precaution, since their fallback values have been present in the repository history.

---

### V-02 — Refresh Tokens Never Rotate or Revoke on Password Change

**Severity:** High **Confidence:** Confirmed
**Affected Component:** Auth
**Affected Files:** `apps/api/src/modules/auth/auth.service.ts` (`refreshTokens()` ~329-348, `issueAccessTokenFromRefresh` ~574-609), `jwt.strategy.ts`

**Description:** Access tokens embed `tokenVersion` and are correctly invalidated on password change (the strategy rejects a stale `tokenVersion`). The `RefreshPayload`, however, has no `tokenVersion` field, and the refresh-token flow only checks `user.active` — it never checks `tokenVersion`. Refresh tokens live for 7 days and are never rotated on use (the same refresh token is valid for its whole lifetime; there is no reuse-detection). There is also **no `/auth/logout` endpoint at all** — logout is client-side-only (deleting from localStorage).

**Attack Scenario:** An attacker who steals a refresh token (XSS, shared-device access, log exposure) can keep minting fresh 8-hour access tokens for up to 7 days — even after the legitimate user notices suspicious activity and changes their password, or "logs out" on a shared device.

**Impact:** Extended unauthorized session persistence after the two events (password change, logout) users would reasonably expect to end all sessions.

**Root Cause:** Refresh-token validity is decoupled from the same revocation mechanism (`tokenVersion`) used for access tokens.

**Recommended Fix:** Add `tokenVersion` to the refresh-token payload and check it on every refresh; implement a real logout endpoint that increments `tokenVersion` (revoking all outstanding tokens) or maintains a server-side refresh-token allow/deny list; consider rotating the refresh token on every use with reuse detection.

---

### V-03 — CORS Allows Any Origin

**Severity:** High **Confidence:** Confirmed
**Affected Component:** API / `apps/api/src/main.ts` (lines ~24, ~54)

**Description:** Both the Vercel serverless bootstrap and the local bootstrap call `app.enableCors()` with **no options object**. The underlying `cors` package's default reflects `Access-Control-Allow-Origin: *` for any request origin, with default methods/headers permitted. `credentials: true` is not set, so the classic wildcard-plus-credentials cookie-theft pattern doesn't apply directly (auth is Bearer-token, not cookie-based) — but any arbitrary website's client-side JavaScript can still call every API endpoint cross-origin and read the JSON response.

**Attack Scenario:** A malicious webpage a hospital staff member happens to visit can make authenticated-looking requests to the API from the victim's browser context if it can also obtain a bearer token (e.g., paired with an XSS or phishing flow), or can probe/enumerate public endpoints (login, forgot-password) directly from any origin with no same-origin restriction at all.

**Impact:** Removes a defense-in-depth layer against cross-origin abuse; widens the effective attack surface for any other client-side vulnerability.

**Recommended Fix:** Configure `enableCors({ origin: [<production frontend origin(s)>], credentials: false })` explicitly, driven by an environment variable, instead of the wide-open default.

---

### V-04 — No Global Rate Limiting

**Severity:** High **Confidence:** Confirmed
**Affected Component:** API-wide

**Description:** No `@nestjs/throttler` (or equivalent) dependency or guard exists anywhere in the codebase. A real per-identifier login lockout does exist (`LoginDirectoryService`: 5 failed attempts → 15-minute lock) and password-reset tokens are well-designed (single-use, short-lived, generic responses) — these meaningfully mitigate credential-stuffing against a *known* identifier and reset-token brute-forcing specifically. But there is **no IP-based or global request-rate limiting** anywhere, so:
- Distributed/low-and-slow brute force across many identifiers is not mitigated.
- Expensive endpoints — PDF/report generation (Puppeteer-backed), CSV/Excel exports (see V-05) — can be called at unlimited request rates by a single authenticated (or in login's case, unauthenticated) caller.

**Impact:** Brute-force, enumeration, and denial-of-service/cost-amplification exposure, particularly on report/export/PDF-rendering endpoints where each request is computationally expensive.

**Recommended Fix:** Add `@nestjs/throttler` globally with a sane default, and tighter, endpoint-specific limits on `/auth/login`, `/auth/forgot-password`, `/reports/*`, and any PDF-rendering routes.

---

### V-05 — Unbounded CSV Report Exports + Formula Injection

**Severity:** High **Confidence:** Confirmed
**Affected Component:** Reports module
**Affected Files:** `apps/api/src/modules/reports/reports.service.ts` (`billingReportCsv`, `outstandingReportCsv`, `patientRegisterCsv`), `apps/api/src/modules/reports/csv.util.ts`

**Description:** All three report CSV generators call `prisma.<model>.findMany({...})` with **no `take` limit**, and the date-range filter is optional — an authenticated caller with the `Report:generate` permission can request, e.g., `GET /reports/billing.csv` with no query parameters and receive every non-cancelled charge line ever recorded for the tenant in a single response. By contrast, other modules in this same codebase (patient search, audit-log export, billing Excel export) correctly cap `take` at 100–5000 — the Reports module is the outlier that missed this pattern.

Separately, `csv.util.ts`'s `toCsv()` only escapes `"`, `,`, and `\n` — it does not neutralize a leading `=`, `+`, `-`, or `@`, which Excel/Sheets interpret as the start of a formula. User-entered fields (patient name, charge description, category name) flow directly into these exports unescaped for formula purposes.

**Attack Scenario:** (a) A caller with report-generation permission triggers a full-tenant data dump in one request, repeatable with no rate limit (see V-04) — a bulk-exfiltration and DoS/cost-amplification vector. (b) A patient or charge record containing a name like `=cmd|'/C calc'!A1` triggers classic CSV formula injection when a staff member later opens the exported file in Excel.

**Impact:** Bulk PHI/financial-data exfiltration risk; potential local code execution on a staff member's machine via formula injection (depending on their Excel macro/DDE settings).

**Recommended Fix:** Require and cap a bounded date range on all three report endpoints (mirroring the `take`-capping pattern already used elsewhere in this codebase); prefix any CSV cell value starting with `=`, `+`, `-`, or `@` with a leading `'` in `toCsv()`.

---

### V-06 — Overbroad Permission Exposes Full Clinical History to Non-Clinical Roles

**Severity:** High **Confidence:** Confirmed
**Affected Component:** Patient module / RBAC
**Affected Files:** `apps/api/src/modules/patient/patient.controller.ts` (`GET :id/history`, `GET :id/master`), `patient.service.ts` (`getPatientMedicalHistory`, `getPatientMasterRecord`), `apps/api/prisma/seed.ts`, `apps/api/src/common/guards/rbac-role-boundaries.spec.ts`

**Description:** Both endpoints are gated only by `@RequirePermission('Employee', 'read')` — a permission meant for identity/registration lookups — but the underlying query includes full diagnoses, prescriptions (with items), lab orders (with results), and therapy sessions for every visit. The seed data grants `Employee:read` to `DataEntryOperator`, `Reception`, `Pharmacist`, `LabTechnician`, `Pathologist`, `QueueManager`, and `Accountant` — none of whom are the intended audience for full clinical notes.

Notably, the project's own test suite (`rbac-role-boundaries.spec.ts`) explicitly asserts "Reception cannot edit clinical diagnoses or prescriptions" by checking that no `Diagnosis`/`Prescription` grant row exists for Reception — but this is checking the wrong boundary. The actual controller never checks `Diagnosis:read`/`Prescription:read`; it checks `Employee:read`, which Reception does hold, so the intended protection the test verifies is not the protection the API actually enforces.

**Attack Scenario:** A Receptionist account (needs `Employee:read` just to do front-desk patient registration/verification) calls `GET /patients/{id}/history` for any patient ID they can access within their hospital's schema and receives that patient's complete diagnosis and prescription history.

**Impact:** Excessive PHI exposure to roles with no clinical justification for it — a clear over-permissioning issue in a hospital system.

**Recommended Fix:** Introduce a dedicated `PatientHistory:read` (or `ClinicalRecord:read`) permission, granted only to clinically appropriate roles (Doctor, Nurse, Administrator, Pathologist as relevant), and keep `Employee:read` scoped strictly to identity/registration-level data.

---

### V-07 — Mass Assignment on `PUT /employees/:id` Bypasses Global Validation

**Severity:** High **Confidence:** Confirmed
**Affected Component:** Employee module
**Affected Files:** `apps/api/src/modules/employee/employee.controller.ts` (line ~72-76), `employee.service.ts` (line ~124-135)

**Description:** The update endpoint is typed as `@Body() updateDto: Partial<CreateEmployeeDto>`. TypeScript's mapped-type erasure means this compiles to `Object` in the emitted metadata (confirmed directly in `apps/api/dist/modules/employee/employee.controller.js`: `__metadata("design:paramtypes", [String, Object])`). NestJS's `ValidationPipe` — which is otherwise correctly configured globally with `whitelist: true, forbidNonWhitelisted: true` — explicitly skips validation for primitive/`Object` metatypes, since there's no class to validate against. The raw request body is then spread directly into `prisma.employee.update({ data: updateDto })`.

The same `Partial<Dto>`-erases-to-`Object` pattern also exists on `PUT /benefit-rules/:id`, `PUT /prescriptions/:id`, and `PUT /settings/hospital` — but those three are currently *not* exploitable because each corresponding service manually destructures only the intended fields before writing. `employee.service.ts` does not do this — it passes the body through unfiltered.

**Attack Scenario:** Any role holding `Employee:update` (Reception, DataEntryOperator, Administrator per seed data) can include extra JSON keys in the request body beyond what the intended edit form would send — any key matching a real column/relation on the `Employee` Prisma model (e.g. `postId`, `gradeId`, `employmentTypeId`) will be silently written, potentially altering values that feed downstream benefit-eligibility or billing logic, with no server-side allowlist preventing it.

**Impact:** Unauthorized modification of employee attributes beyond the intended scope of the update form/endpoint.

**Recommended Fix:** Replace `Partial<CreateEmployeeDto>` with a real, explicit `UpdateEmployeeDto` class (the same pattern already correctly used for `UpdateDoctorDto`/`UpdateStaffDto`, which are unaffected), and have the service build an explicit field allowlist before calling `prisma.employee.update`, matching `doctor.service.ts`/`staff.service.ts`.

---

### V-08 — Pharmacy Stock Dispense Race Condition (Lost Update)

**Severity:** High **Confidence:** Confirmed
**Affected Component:** Pharmacy module
**Affected Files:** `apps/api/src/modules/pharmacy/pharmacy.service.ts` (`dispense`, lines ~154-187)

**Description:** Unlike bed allocation (atomic conditional `updateMany` + unique constraint) and document-sequence numbering (atomic `INSERT ... ON CONFLICT ... RETURNING`) elsewhere in this same codebase — both confirmed correctly race-safe — pharmacy stock dispensing computes the new stock value in application code from a previously-fetched row:
```ts
const batch = await tx.medicineBatch.findUnique({ where: { id: ... } });
if (batch.currentStock < payloadItem.dispenseQuantity) throw new BadRequestException(...);
const updatedBatch = await tx.medicineBatch.update({
  where: { id: batch.id },
  data: { currentStock: batch.currentStock - payloadItem.dispenseQuantity }, // computed from stale read
});
```
This is wrapped in a `$transaction`, but Prisma's interactive transactions default to Postgres `READ COMMITTED`, and the literal decremented value is computed from the transaction's own earlier read — not via an atomic `{ decrement: n }` with a conditional `WHERE currentStock >= n`. There is no database `CHECK` constraint on `currentStock` as a backstop, and no dedicated concurrency test exists for this path (unlike admission/OPD/registration, which each have one).

**Attack Scenario:** A batch has `currentStock = 10`. Two concurrent dispense requests each for quantity 8 both read `currentStock = 10` (both pass the stock check), and both then write their own independently-computed `currentStock = 2`. Sixteen units are physically billed and dispensed, but the batch record only reflects a net decrement of 8 — silently masking overselling.

**Impact:** Inventory count drift (looks like more stock exists than truly does), feeding into low-stock/reorder logic incorrectly, with no error ever surfaced to staff.

**Recommended Fix:** Use the same atomic pattern already proven elsewhere in this codebase: `tx.medicineBatch.updateMany({ where: { id, currentStock: { gte: dispenseQuantity } }, data: { currentStock: { decrement: dispenseQuantity } } })`, check `count === 0` and throw a `ConflictException`/retry. Add a `CHECK (current_stock >= 0)` constraint as a backstop, and a concurrency e2e test analogous to the three that already exist.

---

### V-09 — Plaintext Temporary Password Persisted in Audit Log

**Severity:** High **Confidence:** Confirmed
**Affected Component:** Staff module / Audit interceptor
**Affected Files:** `apps/api/src/modules/user/staff.service.ts` (`resetPassword`, lines ~453-493), `apps/api/src/common/interceptors/audit.interceptor.ts` (lines ~47-99)

**Description:** `resetPassword` correctly hashes the new temporary password for storage, but returns `{ id, email, temporaryPassword }` in the plain HTTP response body. `AuditInterceptor` audits every POST/PUT/PATCH/DELETE and stores `afterSnapshot: JSON.parse(JSON.stringify(responseBody))` for every one of them, with **no field redaction at all** — meaning the plaintext temporary password is persisted verbatim into the `audit_log.after_snapshot` column.

**Attack Scenario:** Anyone with `AuditLog:read` permission (or direct database access) can retrieve a valid, unexpired plaintext credential for any staff member whose password was ever reset, and log in as them during the temp-password validity window.

**Impact:** Audit logs — typically retained long-term and often readable by a broader set of roles than "who can reset passwords" — become a durable credential-leak surface. This is also a **systemic** issue: the same interceptor captures the full, unredacted request body for every PUT/PATCH call, so any future endpoint accepting a password/secret/token field in its body would have it captured the same way.

**Recommended Fix:** Add a field-name denylist (`password`, `temporaryPassword`, `token`, `secret`, `passwordHash`, etc.) applied to both `beforeSnapshot` and `afterSnapshot` before persisting in `AuditInterceptor`, and separately have `resetPassword` deliver the temporary password out-of-band (e.g., a dedicated one-time-reveal flow or emailed link) rather than in a response body that gets audited wholesale.

---

### V-10 — Docker Containers Run as Root

**Severity:** High **Confidence:** Confirmed
**Affected Component:** Docker
**Affected Files:** `apps/api/Dockerfile`, `apps/web/Dockerfile`

**Description:** Neither Dockerfile declares a `USER` directive; both run their `CMD` as the default root user inside the container.

**Impact:** Any remote-code-execution vulnerability in the application or a dependency would execute as root inside the container, widening container-breakout/lateral-movement risk.

**Recommended Fix:** Add a non-root user (official Node images ship a built-in `node` user) and `USER node` before `CMD` in both Dockerfiles.

---

### V-11 — Destructive DB Scripts Have No Environment Guard

**Severity:** High **Confidence:** Confirmed
**Affected Component:** Database maintenance scripts
**Affected Files:** `apps/api/prisma/cleanup.ts`, `delete-emp-1001.ts`, `delete-fake-emps.ts`

**Description:** These scripts instantiate `new PrismaClient()` directly against whatever `DATABASE_URL` is present in the invoking shell's environment, with **no check** on `NODE_ENV`, no host/connection-string allowlist, and no confirmation prompt. `cleanup.ts` in particular unconditionally runs `deleteMany()` across OPD visits, diagnoses, prescriptions, admissions, visits, patient profiles, hospital UIDs, and procurement records.

**Attack Scenario:** If any of these scripts is ever run (by mistake, via a misfired CI job, or copy-pasted into the wrong terminal) with a production-pointing `DATABASE_URL` exported, it will silently and irreversibly delete real clinical/procurement data with no dry-run and no confirmation step.

**Impact:** Irreversible data loss if misused. (Per project memory, the user has stated data loss is an acceptable risk for *this* project's dev/demo data — but these scripts have no mechanism to distinguish dev from production, so the risk isn't actually bounded to dev use.)

**Recommended Fix:** Add an explicit guard (refuse to run unless `NODE_ENV !== 'production'` and/or the resolved `DATABASE_URL` host matches an allowlisted local/dev pattern) plus a required `--yes` confirmation flag.

---

### V-12 — Auth Tokens and User Profile Stored in `localStorage`

**Severity:** High **Confidence:** Confirmed
**Affected Component:** Frontend auth
**Affected Files:** `apps/web/src/hooks/useAuth.ts` (lines ~56-90), `apps/web/src/api/client.ts`

**Description:** Both the access token and refresh token, plus the full user profile object (id, name, email, role, hospitalId), are stored in `localStorage` under a single key. This is JS-readable storage: any successful XSS on the frontend origin (stored, reflected, or DOM-based) can synchronously read and exfiltrate both tokens, granting a valid session with no further authentication needed.

**Mitigating factor:** The backend sets a `Content-Security-Policy: default-src 'self'` with no `unsafe-inline` and no external `connect-src` allowlisted (`security.middleware.ts`), which blocks inline-script execution and cross-origin exfiltration by default — meaningfully raising the bar for a *reflected*-XSS token theft, though it does not eliminate DOM-based XSS risk, and no XSS sink (`dangerouslySetInnerHTML`, raw `innerHTML`) was found anywhere in the current frontend code.

**Impact:** If an XSS vector is ever introduced (a future dependency, a rich-text/notes feature, etc.), tokens are trivially stealable.

**Recommended Fix:** Migrate to httpOnly, `Secure`, `SameSite=Strict/Lax` cookies set by the backend on login, paired with genuine CSRF protection (see V-14) if cookie-based auth is adopted. This is an architectural change — flagged for prioritization, not a quick patch.

---

### V-13 — Suspended Hospital's Issued Tokens Remain Valid

**Severity:** Medium **Confidence:** Confirmed
**Affected Component:** Tenant lifecycle
**Affected Files:** `apps/api/src/common/middleware/tenant-resolution.middleware.ts` (lines ~70-73), `auth.service.ts` (`refreshTokens`, `issueAccessTokenFromRefresh`)

**Description:** For hospital-kind tokens, `hospitalId`/`schemaName` are taken directly from the JWT with no lookup/status check against the platform database (in contrast to the platform-token branch, which does check `status === 'ACTIVE'` before granting cross-tenant access). `hospitals.service.ts` documents a comment claiming "suspension blocks every path into the tenant's data" — true only for new logins and for the Super Admin's cross-hospital path, not for already-issued hospital-staff tokens.

**Attack Scenario (same-tenant, not cross-tenant):** After an Administrator suspends/offboards a hospital, any staff member holding a still-valid access token (up to 8h) or refresh token (up to 7 days) can keep operating against that hospital's own schema.

**Impact:** Contradicts the documented security guarantee; a real incident-response gap — an offboarded or compromised hospital tenant cannot actually be cut off immediately.

**Recommended Fix:** At minimum, have `refreshTokens()`/`issueAccessTokenFromRefresh()` check hospital status (closes the 7-day exposure cheaply); for the stronger fix, have `TenantResolutionMiddleware` do a lightweight (optionally cached) hospital-status check for hospital-kind tokens too.

---

### V-14 — CSRF Protection Is Non-Functional

**Severity:** Medium **Confidence:** Confirmed
**Affected Component:** `apps/api/src/common/middleware/security.middleware.ts` (lines ~15-36)

**Description:** The middleware reads an `x-csrf-token` header; if absent, it **generates a brand-new token on the spot** and echoes it back. There is no server-side session/store binding a previously-issued token to a specific client, so "validation" only checks that *some* string is present in that header (or that an `Authorization` header exists) — never that it matches a known-good value.

**Context:** Because auth is Bearer-token-based (not cookie-based), genuine CSRF risk here is low — a cross-site form/XHR cannot automatically attach a bearer token. The real issue is that this code creates a false sense of a working, compliance-relevant control.

**Recommended Fix:** Either remove this mechanism and document that Bearer-token auth doesn't require CSRF protection, or implement it properly (double-submit cookie or session-bound token) if cookie-based auth is ever adopted (see V-12).

---

### V-15 — Audit Interceptor Captures Unredacted Request/Response Bodies System-Wide

**Severity:** Medium **Confidence:** Confirmed
**Affected Component:** `apps/api/src/common/interceptors/audit.interceptor.ts`

**Description:** Beyond the specific temp-password case (V-09), this interceptor stores the full request body (`beforeSnapshot`) for every PUT/PATCH and the full response body (`afterSnapshot`) for every mutating call, across every module, with no field-level redaction. For a clinical audit trail this granularity is often a compliance requirement — but it means the audit log becomes a second, potentially more broadly-readable copy of the same sensitive data (prescriptions, diagnoses, and any future field containing a secret) as the primary records.

**Recommended Fix:** Apply a denylist-based redaction pass (password/token/secret-shaped field names) to both snapshots before persisting; separately confirm `AuditLog:read` is granted only to appropriately narrow roles.

---

### V-16 — Unvalidated Branding Endpoint Enables Injection into Shared PDF Renderer

**Severity:** Medium **Confidence:** Confirmed
**Affected Component:** Branding / document rendering
**Affected Files:** `apps/api/src/modules/auth/branding.controller.ts` (line ~41), `apps/api/src/common/rendering/pdf-templates.ts` (lines ~15-16), `document-render.service.ts`

**Description:** `pdf-templates.ts` consistently escapes user-controlled values via an `escapeHtml()` helper — with one exception: `branding.primaryColor` is interpolated raw into a `<style>` block. That value comes from `PUT /branding`, whose handler is typed `@Body() body: any` with **no DTO class**, so the global `ValidationPipe`'s `forbidNonWhitelisted`/whitelist protection has nothing to validate against and silently allows arbitrary values through.

**Attack Scenario:** An authenticated user holding the `BrandingConfig:update` permission sets `primaryColor` to a value like `red } </style><script>...</script><style>`, breaking out of the style block. Because `DocumentRenderService.renderPdf()` runs on a **shared, long-lived Puppeteer browser instance used for every tenant's receipts/reports**, the injected script executes server-side in that shared process on every subsequent render — a potential DoS of the shared renderer (affecting all tenants) or a pivot point for further server-side requests.

**Recommended Fix:** Escape `primaryColor` like every other interpolated field, and add a real DTO with strict validation (e.g. `@Matches(/^#[0-9a-fA-F]{6}$/)`), so `forbidNonWhitelisted` actually applies.

---

### V-17 — Predictable Seed Passwords

**Severity:** Medium **Confidence:** Confirmed
**Affected Component:** `apps/api/prisma/seed.ts` (lines ~825-1049)

**Description:** Seeded accounts for every role use a predictable pattern: `DoctorPass123!`, `AdminPass123!`, `NursePass123!`, `PharmacistPass123!`, `ReceptionPass123!`, `LabTechPass123!`, etc.

**Impact:** If this seed script is ever run against a shared demo/staging environment reachable by real users (or production, by mistake), anyone who knows or guesses the convention gets instant access to every role — unless `mustChangePassword` is confirmed set on all seeded accounts (worth verifying operationally).

**Recommended Fix:** Randomize seed passwords per environment, or gate the seed script so it can never target a non-local `DATABASE_URL`.

---

### V-18 — No Idempotency Protection on Charge Creation

**Severity:** Medium **Confidence:** Likely
**Affected Component:** Billing module

**Description:** `ReceiptService.issue` correctly validates every charge is still `PENDING` before marking it `PAID`, preventing double-payment of the *same* charge. However, there is no idempotency-key mechanism on the charge-*creation* endpoints (`postServiceCharge`/`postPharmacyCharge`) — a double-click or client retry that fires two separate creation requests is not deduplicated, and could create two separate `PENDING` charges for the same clinical act.

**Recommended Fix:** Add an idempotency key (client-generated request ID, or a hash of visit+service+time-window) enforced via a unique constraint on charge-creation endpoints.

---

### V-19 / V-22 — Dev Docker Compose Network & Credential Hygiene

**Severity:** Medium (port exposure) / Low (hardcoded dev credentials) **Confidence:** Confirmed
**Affected Component:** `docker-compose.yml`

**Description:** Postgres (`5433:5432`) and Redis (`6379:6379`) are bound with no host-IP restriction, so they're reachable from any interface on the host rather than only from other containers on the internal network — unnecessary since `api`/`web` already reach them by service name. The compose file also hardcodes plaintext dev credentials (`esic_user`/`esic_password`). This file is explicitly labeled as dev-only (`NODE_ENV: development`, `start:dev` hot-reload command) — low real-world risk **as long as it is never reused as-is for staging/production**.

**Recommended Fix:** Bind to `127.0.0.1:<port>:<port>` (or drop the mapping and use `docker compose exec`) for local debugging; move credentials to a gitignored `.env` consumed via `env_file:`; ensure a distinct, hardened compose/Dockerfile path is used for any non-local deployment.

---

### V-20 — Latent Mass-Assignment Pattern in Other Modules

**Severity:** Medium (currently mitigated) **Confidence:** Confirmed
**Affected Files:** `benefit.controller.ts` (`PUT /benefit-rules/:id`), `prescription.controller.ts` (`PUT /prescriptions/:id`), `hospital-settings.controller.ts` (`PUT /settings/hospital`)

**Description:** The same `Partial<Dto>`-erases-to-`Object` TypeScript pattern as V-07 exists here too, confirmed via the same compiled-metadata check. These are **not currently exploitable** because each service manually destructures only the intended fields before persisting (and `prescription.service.ts`'s update path doesn't persist the merged object to the DB at all, which is a separate functional — not security — concern). This safety currently depends entirely on hand-written allowlisting remaining correct in each service, with no framework-level backstop.

**Recommended Fix:** Replace with real DTO classes at each of these three call sites, consistent with the V-07 fix, so the framework-level backstop exists everywhere rather than only in service-layer discipline.

---

### V-21 — No Automated Cross-Tenant Isolation Test

**Severity:** Medium **Confidence:** Confirmed
**Affected Files:** `apps/api/test/security.e2e-spec.ts`, `apps/api/test/rbac.e2e-spec.ts`

**Description:** Neither existing e2e spec provisions two hospitals and asserts that one cannot read/write the other's data via a manipulated `x-hospital-id` header or a mismatched token. Given the tenant-isolation mechanism (V-13 aside) was found to be otherwise well-designed, this is a **regression-prevention gap**, not a currently-known break — but a future refactor of `TenantResolutionMiddleware`, `TenantClientFactory`, or the `PrismaService` proxy could silently reintroduce a cross-tenant leak with nothing in CI to catch it.

**Recommended Fix:** Add an e2e spec that provisions two hospitals, authenticates staff for each, and asserts every relevant path (data reads/writes, the platform `x-hospital-id` header, JWT `schemaName` claims) is correctly bounded to the intended tenant.

---

### Low-Severity Findings (V-23 – V-28)

- **V-23 — Missing security headers:** `security.middleware.ts` sets HSTS, `X-Content-Type-Options`, `X-Frame-Options`, and a coarse `CSP: default-src 'self'`, but omits `Referrer-Policy` and `Permissions-Policy`, and doesn't fine-tune `script-src`/`style-src`/`frame-ancestors`/`object-src`. Low impact since the API itself renders no HTML. *Fix:* add the missing headers; tighten CSP directives.
- **V-24 — Unvalidated `patient.photoUrl`:** accepted as a plain string with no `@MaxLength` or MIME/data-URI format check, stored verbatim in Postgres (no file-storage subsystem exists yet). *Fix:* add length cap and format validation.
- **V-25 — Minor DTO gaps:** `DispenseMedicineDto.dispenseQuantity` lacks `@IsPositive()`/`@Min(1)`; the service layer already rejects non-positive quantities before any mutation, so this is defense-in-depth only. *Fix:* add the decorator anyway.
- **V-26 — `GET /users` permission mismatch:** guarded by `RequirePermission('Admission', 'update')` rather than something reflecting the actual resource (a low-sensitivity id/identifier/role listing). *Fix:* rename to a fitting permission for clarity in future audits.
- **V-27 — No global body-size limit:** `main.ts` doesn't configure `bodyParser.json({ limit })`; Express/body-parser's default (100kb) currently applies everywhere, including the base64 Excel-import endpoint. Low risk today, but fragile if that default is later "fixed" by cranking the limit up without a deliberate ceiling. *Fix:* set an explicit, intentional limit.
- **V-28 — Tenant-client-factory connection-leak race:** concurrent first requests for a brand-new tenant schema can each build and `$connect()` their own `PrismaClient`; the loser's connection is never explicitly disconnected (a resource leak, not a data leak — each client still points at the correct schema). *Fix:* dedupe concurrent cache misses via a per-schema in-flight promise.

### Informational Findings

- **I-01:** No field-level/column-level encryption exists for PII or medical data — everything beyond password hashes is plaintext in Postgres. Common for this class of system; worth a future roadmap item given the health-data context.
- **I-02:** Docker base images float on minor/patch versions (`node:20-...`, `postgres:15-alpine`, `redis:7-alpine`); dependency pinning is inconsistent (API mostly exact versions, web mostly caret ranges). No specific unpatched CVE was identified in the versions reviewed; recommend running `npm audit`/`pnpm audit` and enforcing `--frozen-lockfile` in CI as the actual control.
- **I-03:** A stale code comment in `rbac-admin.service.ts` still describes the retired role-name-based SuperAdmin bypass. No exploitation path was found, but recommend a one-time query across existing tenant schemas for any leftover `Permission` row with `resource = '*'` from before this retirement, since `RbacGuard`'s wildcard check would still honor one if it existed.

### Confirmed-Safe / Positive Controls (worth preserving, not re-litigating)

- Password hashing: bcrypt, cost 10, applied consistently everywhere passwords are set.
- Password-reset tokens: 32-byte random, SHA-256-hashed at rest, single-use, 30-minute expiry.
- Account enumeration: login and forgot-password responses are confirmed generic regardless of identifier validity.
- Per-identifier login lockout (5 attempts / 15-minute lock) is real and functioning.
- `AllExceptionsFilter` never leaks stack traces, DB errors, or internal paths to the client, in any environment (unconditional, not just a `NODE_ENV` branch).
- Schema-per-tenant DDL (`CREATE`/`DROP SCHEMA`) is protected by a validated identifier allowlist regex at two layers (DTO + service) — no SQL injection path found.
- `PrismaService` is an `AsyncLocalStorage`-backed `Proxy`, making it architecturally difficult for any service to accidentally bypass tenant scoping.
- Bed allocation, document-sequence numbering, and employee-registration concurrency are all correctly atomic (verified against their dedicated e2e concurrency specs).
- Prescription signing, lab result verification, and admission discharge all enforce role and status-transition rules in the **service layer**, not merely via the RBAC decorator — a real defense-in-depth pattern.
- No command-injection, SSRF, or NoSQL-injection surface currently exists (no shell-invoking code with user input; no outbound HTTP client with user-controlled URLs; Prisma/Postgres only, no Mongo).
- No `dangerouslySetInnerHTML` or raw `innerHTML` usage anywhere in the frontend.
- `.env` files are correctly gitignored and confirmed not tracked by git.
- `rbac-matrix.spec.ts` is a genuinely strong structural control — a static test that fails if any controller route lacks an explicit auth decorator, with its own history of catching a real bug.

---

## Top 10 Security Risks

**Critical**
1. **V-01 — Hardcoded fallback JWT secrets.** A single deployment misconfiguration away from full auth bypass and cross-tenant compromise; fix first, regardless of anything else in this report.

**High**
2. **V-06 — Overbroad clinical-data permission.** Currently, real front-desk/billing roles can read full patient diagnosis/prescription history today, in the system as deployed — no misconfiguration required.
3. **V-07 — Mass assignment on employee updates.** A live, exploitable gap in the framework's own validation guarantee for at least one endpoint.
4. **V-08 — Pharmacy stock race condition.** A real correctness/financial-integrity bug, not just a theoretical concurrency concern, in a system that otherwise gets concurrency right.
5. **V-09 — Plaintext temp passwords in audit logs.** A durable credential-leak surface with a straightforward fix.
6. **V-12 — Tokens in localStorage.** Standard XSS-exfiltration exposure; no XSS sink currently exists, but the blast radius if one is ever introduced is total account takeover.
7. **V-05 — Unbounded report exports.** Realistic bulk-exfiltration and DoS vector, live today for any role with report-generation permission.
8. **V-04 — No rate limiting.** Amplifies nearly every other finding (brute force, export abuse, PDF-generation DoS).
9. **V-10 / V-11 — Infrastructure hardening gaps.** Root containers and unguarded destructive scripts are both "one mistake away from serious impact" issues.

**Medium**
10. **V-13 — Suspended-hospital session persistence.** Directly contradicts a security guarantee the team has explicitly documented elsewhere in the codebase, making it a credibility/compliance issue as well as a technical one.

---

## Security Audit Checklist

| Area | Status | Notes |
|---|---|---|
| Authentication | ⚠️ | Strong password/reset design and account-enumeration protection, undermined by V-01 (hardcoded secret fallback) and V-02 (no refresh rotation/revocation) |
| Authorization | ⚠️ | Strong structural framework (`rbac-matrix.spec.ts`) but real gaps found: V-06 (overbroad permission), V-07/V-20 (mass assignment) |
| Tenant isolation | ⚠️ | Core mechanism is soundly designed and no cross-tenant leak was found, but V-01 threatens it structurally and V-13 breaks a documented guarantee; V-21 notes missing regression coverage |
| API security | ⚠️ | V-03 (CORS), V-04 (no rate limiting), V-05 (unbounded exports) |
| Database security | ✅ | No injection path found; schema-name handling is safe; main residual risk is V-11 (unguarded destructive scripts), an operational/process issue rather than a code vulnerability |
| File security | ✅ (N/A) | No file-upload subsystem exists yet; revisit this category when one ships |
| Secrets | ❌ | V-01 is a critical, live risk in the source code regardless of current runtime configuration |
| Frontend security | ⚠️ | V-12 (localStorage tokens), but no XSS sinks found and CSP meaningfully mitigates the residual risk |
| Infrastructure | ⚠️ | V-10 (root containers), V-19 (exposed dev ports) — both dev/deploy hygiene issues, not application-logic bugs |
| Dependencies | ✅ | No confidently-identified unpatched CVEs in current pinned versions; recommend `pnpm audit` as ongoing practice |
| Logging/privacy | ⚠️ | V-09 (plaintext temp password) and V-15 (systemic unredacted audit snapshots) |
| Business logic | ⚠️ | V-08 (pharmacy race) is real; prescription/lab/billing/admission workflow-locking is otherwise confirmed solid |

---

*This report reflects a point-in-time static review. No penetration testing, dependency-vulnerability scanning (`npm audit`), or dynamic testing against a running instance was performed. Findings should be independently re-verified before remediation and re-audited after fixes land.*
