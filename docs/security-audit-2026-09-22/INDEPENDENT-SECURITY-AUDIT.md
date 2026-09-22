# Independent Security Audit — ESIC Hospital Management System

**Date started:** 2026-09-22
**Auditor:** Claude (Sonnet 5), working interactively with the repo owner
**Method:** Fresh, independent audit — conducted without relying on conclusions from the prior `docs/SECURITY-AUDIT-REPORT.md` (2026-09-19). That report and `docs/developer/05-RBAC-Security.md` / `docs/developer/23-Security-Audit.md` are cross-checked only at the very end, as a sanity comparison, not as an input to findings here.
**Status:** Core phases complete (0, 1, 2, 3, 4, 5, 6-partial, 7, 9-targeted, 11-partial, 12, 13). Not exhaustive — see "Not covered" below.

---

## Executive Summary

**Overall posture:** solid architectural foundations (schema-per-tenant isolation, structural RBAC-coverage enforcement via `rbac-matrix.spec.ts`, consistent HTML-escaping in server-rendered PDFs, tiered rate limiting) held up under live, active testing — not just static review. The most significant issues found were a **live-breaking functional bug** (hospital onboarding was completely broken) that turned out to have a **real security side-effect** (internal error disclosure) bundled with it, both now fixed and verified; and a handful of genuine but bounded gaps (missing frontend security headers, one production-reachable dependency ReDoS, an incomplete httpOnly-cookie migration).

**No cross-tenant data leak, injection vulnerability, or broken-authentication issue was found** across header manipulation, JWT tampering, direct cross-tenant ID access, and active-scan injection testing against live endpoints — this is a materially stronger result than a static-only review can give, since it's evidence the controls actually work under attack traffic, not just that the code looks right.

| Severity | Count | Status |
|---|---|---|
| Critical | 0 | — |
| High | 6 | **All 6 fixed** (T-01, T-02, T-03, D-02, D-02-REGRESSION, A-02-REGRESSION) |
| Medium | 5 | **All 5 fixed** (A-02, R-01, R-02, R-03, D-04) |
| Low | 3 | 2 fixed this session (D-03, D-06); 1 open (R-05) |
| Informational | 2 | 1 new this session (STALE-DEPLOY), 1 open (D-05) |

**Every finding from this audit is now fixed except R-05 (cosmetic) and STALE-DEPLOY (an operational gap, not a code fix).** Fixed across five commits: `68c1687`+`efd822b` for the onboarding/disclosure bugs, `3f990a5` for the first round of headers/dependencies, `acbc293` for the governance-doc correction, plus this session's not-yet-committed work completing A-02 end-to-end (backend **and** frontend), the `D-02-REGRESSION` fix it surfaced, the `A-02-REGRESSION` login-lockout bug found live-testing it, and the D-03/D-06 dependency bumps. **See STALE-DEPLOY below before assuming any of this is live in production** — as of this session, Railway is still running a build that predates even the *first* round of fixes.

### Findings by severity

**High**
- **T-01 — Verbose internal error disclosure** (3 call sites leaked raw Prisma/schema internals to clients on 500s). **FIXED**, commit `68c1687`.
- **T-02 — Hospital onboarding completely broken** (root cause: non-existent fields passed into an audit-log write, causing a misleading Prisma error). **FIXED**, commit `efd822b`, verified end-to-end on live deployment.
- **T-03 — Missing `TenantMigrationService` dependency injection**, a genuine pre-existing compile error that would have broken onboarding again even after T-02's fix. **FIXED**, commit `68c1687`.
- **D-02 — `path-to-regexp@0.1.12` ReDoS**, production-reachable via Express/NestJS. **FIXED**, commit `3f990a5` (pnpm override).
- **D-02-REGRESSION — the D-02 override itself silently broke Express's entire route-matching layer (found while implementing A-02, this session).** **FIXED**, not yet committed — see full writeup below.
- **A-02-REGRESSION — the CSRF check added for A-02 could permanently 403-lock a user out of `/api/auth/login` itself if they held any still-valid cookie (found live-testing A-02 in a real browser, this session).** **FIXED**, not yet committed — see full writeup below.

**Medium**
- **A-02 — httpOnly auth cookie + double-submit CSRF, now fully implemented end-to-end (backend AND frontend) and verified live in a real browser.** **FIXED**, not yet committed — see full writeup below.
- **R-01 — Frontend (Vercel) ships with zero application-level security headers** (no CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy). **FIXED**, commit `3f990a5` (`vercel.json` headers block). **Needs verification after next Vercel deploy** — the CSP couldn't be visually tested against the live site from here; check browser console for CSP violations, especially around fonts/inline styles.
- **R-02 — API missing `Referrer-Policy`/`Permissions-Policy`, leaks `X-Powered-By: Express`**. **FIXED in source**, commit `3f990a5` — **but see STALE-DEPLOY: not actually live on Railway as of this session.**
- **D-04 — `react-router`/`@remix-run/router` open redirect** via protocol-relative URL, shipped to every browser session. **FIXED**, commit `3f990a5` (`react-router-dom` 6.28.1 → 6.30.6).
- **R-03 — `docs/08-security-governance-matrix.md` describes non-existent controls** (a `csrf-token` endpoint that was deliberately removed; an incident-response/backup runbook that couldn't be corroborated against any code). **FIXED**, commit `acbc293`.

**Low**
- **D-03 — `qs` DoS**, production-reachable via Express/body-parser. **FIXED**, not yet committed (pnpm override, `qs` 6.13.0 → 6.16.0, patches three separate advisories).
- **D-06 — `brace-expansion` DoS** via the `minimatch`/`glob` chain several of this repo's own dependencies pull in. **FIXED**, not yet committed (pnpm overrides pinned per major line already in use: `1.x` → `1.1.18`, `2.x` → `2.1.4` — a dev-tooling-only `5.x` chain via `rimraf`'s `clean` script was left as-is, see its writeup below for why).
- **R-05 — HSTS header inconsistently present** on a few unmatched-route 404 responses — low impact (real pages already send it), open.

**Informational**
- **STALE-DEPLOY — Railway production is running a build older than commit `3f990a5` (new finding, this session).** See full writeup below. Not itself a vulnerability, but it means every "FIXED" item above isn't actually protecting the live deployment yet, and it's worth finding out why the deploy didn't roll forward before assuming any local fix is live.
- **D-05 — `multer` high-severity CVEs, but the package is unused** (no upload subsystem exists) — no action needed beyond routine pruning, open.

### Confirmed-safe / positive controls (verified live, not just by reading code)
- Rate limiting is active and tiered (10 req/60s on login, 120 req/60s general) — **contradicts and updates** the prior report's "no rate limiting" finding.
- JWT signature and payload integrity correctly enforced — tampering (signature bit-flip, payload field changes, `schemaName` tampering specifically) all rejected with clean `401`s.
- `x-hospital-id` header correctly ignored for hospital-staff tokens — no tenant-scope override possible via header manipulation.
- Direct cross-tenant record-ID access returns `404` — schema-per-tenant isolation confirmed empirically, not just architecturally.
- Zero SQLi/XSS/injection alerts under active ZAP scanning (medium strength) against 4 live POST JSON-body endpoints, plus targeted manual injection/path-traversal probes.
- `escapeHtml()` consistently applied across all server-rendered PDF templates (payment receipts, lab reports).
- No secrets found in source; `.env` files correctly gitignored and untracked.
- Generic, stack-trace-free error responses on all standard (non-`InternalServerErrorException`-wrapped) failures.
- `changePassword` correctly bumps `tokenVersion`, immediately invalidating previously-issued tokens.
- `rbac-matrix.spec.ts` — a genuinely strong structural control — passes right now, confirming complete auth-decorator coverage across all 221 routes.

### Not covered in this pass
Write-path cross-tenant tests (POST/PATCH against another tenant's records), refresh-token rotation/reuse-detection testing, suspended-hospital token persistence (V-13 territory), full business-logic workflow testing (Phase 16), Docker/infrastructure hardening beyond what Phase 1 covered, and TLS/HTTPS (out of scope — both hosts are on managed platforms). Recommend as follow-up work, not urgent given time already invested and the strength of results so far.

---

## Phase 0 — Audit Setup & Scope

| Item | Value |
|---|---|
| Target | (1) Local dev stack (`docker-compose.yml`: API `http://localhost:3000/api`, Web `http://localhost:5173`). (2) Deployed staging/demo: Web — `https://esic-hms-web.vercel.app` (Vercel), API — `https://api-production-a838.up.railway.app` (Railway). |
| Environment | Local dev **and** a deployed staging/demo environment — confirmed by the repo owner to hold **no real hospital/patient data**, seed/demo data only. Full active testing (ZAP active scan, injection payloads, auth abuse testing) is authorized against **both** targets. |
| Authorization | Repo owner's own application on their own Vercel/Railway accounts; explicit confirmation given that the deployed instance is staging/demo, not production, and that full active testing is authorized there. |
| Scope (in) | `apps/api` (NestJS/Prisma backend), `apps/web` (Vite/React frontend), `docker-compose.yml` + both `Dockerfile`s, Prisma schema/migrations, plus the two staging URLs above |
| Scope (out) | Any *other* deployment not listed above (if one exists, e.g. a real production URL), third-party services the app integrates with (none currently identified — see Phase 1), CI/CD pipeline security, Vercel/Railway platform infrastructure itself (only this app's config/behavior on top of it is in scope) |
| Auth mechanism (to verify independently in Phase 5) | JWT bearer tokens, two independent signing domains (hospital-staff vs platform) per initial code read |
| Test accounts | Seeded via `apps/api/prisma/seed.ts` with `SEED_USE_PREDICTABLE_PASSWORDS=true` (dev-only compose default). One account per role: Administrator, Doctor, Nurse, Pharmacist, StoreManager, ProcurementOfficer, Reception, AdmissionDesk, DataEntryOperator, QueueManager, LabTechnician, Pathologist, Accountant, OPDDisplayOperator. Platform Super Admin: `superadmin@platform.local` (dev default password, not written here). |
| Roles (14 hospital-tenant roles + 1 platform Super Admin) | See table above |

---

## Phase 1 — Application Architecture (independently derived)

**Frontend:** Vite 5 + React 18.3 + React Router 6.28, TypeScript. No SSR. Talks to the API only via `fetch`/`VITE_API_URL`. State/session held in `localStorage` under a single key (`esic-hms-auth`) — access token, refresh token, and full user profile together (auth flow detail to be tested for real impact in Phase 5/Phase 11).

**Backend:** NestJS 10 on Express 4, Prisma 5.22 ORM, PostgreSQL 15. Deployed as a Vercel serverless function in production (`main.ts` exports a handler keyed on `process.env.VERCEL`); a local long-running process is used for dev (`bootstrapLocal()`).

**Database:** PostgreSQL 15. **Multi-tenancy model: schema-per-tenant.** Each hospital gets its own Postgres schema; a separate `public` schema holds the platform control-plane (`Hospital`, `PlatformUser`, `PlatformAuditLog`). This is the single highest-value area for the Phase 7 tenant-isolation audit — a schema-per-tenant model is stronger than a shared-table + `tenant_id` column model *if* (and only if) the schema selection itself can never be influenced by an untrusted client value.

**Cache/Queue:** Redis 7, provisioned in `docker-compose.yml`. Declared purpose per the compose file's own comments: OPD queue token counters (atomic `INCR`), BullMQ job queues, short-lived session/cache data — actual usage in `apps/api/src` to be confirmed in Phase 1b, not assumed from the comment alone.

**File storage:** No multer / object-storage dependency found in `apps/api/package.json`. Patient photos are handled as base64 data URLs inside JSON bodies (per an explicit comment in `main.ts` about the raised 10MB body limit), not multipart file uploads. File-upload-specific attack categories (Phase 10) are provisionally **not applicable** — to be confirmed, not assumed, when the relevant DTO/controller is read directly.

**WebSockets:** No `socket.io`/`ws`/`@nestjs/websockets` dependency found. Not applicable.

**External services:** `nodemailer` is a dependency (likely password-reset/notification email) — to be traced in Phase 8. No AWS SDK, Stripe/Razorpay, Twilio, Sentry, or S3/Cloudinary dependency found — no other external service integration currently exists.

**Auth (surface-level, to verify in Phase 5):** `@nestjs/jwt` + `@nestjs/passport`, `bcryptjs` for hashing. Two JWT domains referenced in `docker-compose.yml` env vars: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_PLATFORM_SECRET`.

**Authorization (surface-level, to verify in Phase 6):** A single `RbacGuard` + `@RequirePermission(resource, action)` decorator pattern; permission grants defined in `apps/api/prisma/seed.ts` (`PERMISSION_GRANTS`); an existing static test `rbac-matrix.spec.ts` asserts every controller route carries an explicit auth decorator.

**Security middleware present (to verify headers/CORS specifics in Phase 11):** `resolveCorsOrigins()` used in `nestApp.enableCors({ origin: resolveCorsOrigins(), credentials: true })` — an explicit allowlist function, not a wildcard, per current `main.ts` (this differs from what the 2026-09-19 report described — to be verified fresh, not assumed fixed, in Phase 11).

**Rate limiting:** `@nestjs/throttler` is a dependency (`user-aware-throttler.guard.ts` exists) — scope/coverage to verify in Phase 8.

**Deployment:** Docker Compose for local dev only (Postgres loopback-bound `127.0.0.1:5433`, Redis loopback-bound `127.0.0.1:6379` — both already loopback-restricted in the current compose file). Production is Vercel serverless per `main.ts`. No dedicated production Dockerfile/compose was found in this pass.

**Sensitive data handled:** Patient PHI (diagnoses, prescriptions, lab results, admission records), staff PII, billing/financial records — this is a healthcare system, so PHI exposure and cross-tenant (cross-hospital) leakage are the two highest-stakes categories for this audit.

**Documentation vs. reality flag (Phase 1 finding, not yet severity-scored):** `docs/08-security-governance-matrix.md` lists `GET /api/auth/csrf-token` as a real, universally-accessible endpoint and describes a full backup/incident-response runbook (specific SLAs, "ESIC Cyber Cell" escalation). This needs independent verification in Phase 8/11 — documentation asserting a control exists is not evidence that it does.

---

## Phase 2 — Reconnaissance

**Method:** Passive recon only (plain GET/POST, no payloads) against both deployed staging targets, cross-checked against source where relevant.

### Findings

**R-01 — Frontend (Vercel) ships with zero application-level security headers**
- Severity (provisional): Medium
- Evidence: `curl -sSI https://esic-hms-web.vercel.app` returns only `Strict-Transport-Security` (a Vercel platform default) — no `Content-Security-Policy`, `X-Frame-Options`, `Referrer-Policy`, or `Permissions-Policy`.
- Root cause confirmed in source: `apps/web/vercel.json` has a `rewrites` block but no `headers` block at all.
- Impact: the login page (and every other page) can be framed in a third-party `<iframe>` (clickjacking), and there is no CSP backstop if an XSS vector is ever introduced into the frontend.
- Contrast: the API (`security.middleware.ts`) does set CSP/X-Frame-Options/HSTS/nosniff — this protection simply never extended to the static frontend, which is a separate deployment target (Vercel) with its own config surface.

**R-02 — API missing `Referrer-Policy` / `Permissions-Policy`; leaks `X-Powered-By: Express`**
- Severity (provisional): Low
- Evidence: live header dump from Railway matches `security.middleware.ts:24-32` exactly — confirms the middleware is what's actually running in this deployment (not stale/bypassed).
- `X-Powered-By: Express` is Express's default banner; framework/version fingerprinting aid for an attacker, trivial to disable.

**R-03 (documentation defect, not a code vulnerability) — `docs/08-security-governance-matrix.md` describes non-existent controls**
- Confirmed: `GET /api/auth/csrf-token` returns `404` live; the corresponding middleware was deliberately *removed* (not implemented) per an explicit comment in `security.middleware.ts:4-21` explaining Bearer-token auth doesn't need CSRF protection — a reasonable engineering decision, but the governance doc still lists the token endpoint as accessible to all 10 roles, and separately describes a full backup/incident-response runbook (specific SLAs, "ESIC Cyber Cell" escalation) that could not be corroborated against any code in this pass.
- Why this matters for a government system: a governance doc asserting compliance controls that don't exist is itself a finding — it would fail an external audit or compliance review that trusted the document instead of the running system.

**Confirmed-safe / positive controls**
- No stack traces, DB error text, or internal file paths leak on `404` or malformed-input responses (`AllExceptionsFilter` — generic JSON with a `requestId`, confirmed live).
- No real files exposed at common sensitive paths (`.env`, `.git/config`, etc.) — all fall back to the SPA shell as expected from `apps/web/vercel.json`'s catch-all rewrite.
- No source maps shipped (`vite.config.ts` has no `build.sourcemap` — confirmed via local production build, zero `sourceMappingURL` occurrences).

### Note on Vercel Preview Deployments (not yet checked — needs the account owner)
Vercel auto-deploys a preview URL for every branch/PR by default, and unless **Deployment Protection** (Vercel Authentication or a password) is explicitly enabled, these preview URLs are often publicly reachable with a predictable/discoverable pattern, sometimes pointed at the same database as production. This can't be checked by probing from outside (I won't guess preview URLs), so: **please check your Vercel dashboard → Project Settings → Deployment Protection**, and tell me what it's currently set to.

## Phase 3 — OWASP ZAP

### 3a. Baseline scan against the Railway API (`zap-baseline.py`)

**Result: low signal.** ZAP's spider only found 4 URLs (`/`, `/api`, `/robots.txt`, `/sitemap.xml`) — all 404, since this is a bare JSON API with no crawlable HTML links and no OpenAPI/Swagger spec for ZAP to import. The automation plan itself logged spider errors ("status code returned: 404 expected 200"). **This scan did not reach a single real endpoint.** Findings from it:

- **R-04 — `X-Powered-By: Express` leaked (Low, ZAP plugin 10037).** Confirmed on all 4 tested URLs. Matches R-02 above; same fix (`app.disable('x-powered-by')` or equivalent).
- **R-05 — HSTS header inconsistently present (Low/Informational).** Present on `/api`, absent on `/`, `/robots.txt`, `/sitemap.xml`. Checked source: `SecurityMiddleware` is registered via `consumer.apply(...).forRoutes('*')` in `app.module.ts:133`, which should cover every request reaching the Nest app — so this isn't an app-level route-scoping bug. More likely explanation: Railway's edge proxy (`railway-hikari`, visible in headers) handles some 404s before/differently from the Node process. Low real-world impact (HSTS only needs to be seen once on a real page load, which `/api/health` already confirmed it is), but worth a platform-level HSTS setting as a backstop rather than relying solely on app middleware.
- No Medium/High findings from this pass — but see the caveat above about coverage.

**Action needed:** re-scan properly seeded with the actual endpoint list (Phase 3b below), since this pass tested almost nothing.

### 3b. Endpoint inventory (built for ZAP seeding + doubles as the Phase 8 attack-surface checklist)

Extracted directly from `apps/api/src/**/*.controller.ts` via a small AST-lite parser (path + HTTP verb only — decorator detection in this custom script proved unreliable, see below): **221 routes** across 33 controllers.

**Important methodology note:** My first pass tried to also detect the auth decorator per route via a simple backward-line-scan regex, and flagged ~49 mutating routes as having "no explicit permission decorator" — that looked like a real finding (matches the shape of the prior report's H1/rbac-matrix concern). Before reporting it, I checked the actual mechanism: this repo has an existing static-analysis test, `rbac-matrix.spec.ts`, that parses the real TypeScript AST (not a line-window regex) and asserts every handler is `@Public()`, `@RequirePermission`/`@Roles`-guarded, or explicitly allow-listed with a stated reason (e.g. `platform/*` routes are guarded via a controller-level `@UseGuards(PlatformOnlyGuard)`, which a per-method scan can't see). **I ran it directly: `npx jest --testPathPattern=rbac-matrix` → 5/5 tests pass**, right now, against the current code. That's authoritative, freshly-verified confirmation that route-guard coverage is complete — my regex's "49 unguarded routes" list was a false positive from its own blind spot (class-level guards), not a real finding. Logged here so the false-positive-catch itself is part of the audit trail.

**Positive control (independently confirmed, not assumed):** `rbac-matrix.spec.ts` is a genuinely strong structural control — it fails CI if any route lacks an explicit auth decorator or justified allowlist entry, in both directions (also catches `@Public()` routes not explicitly justified, and permissions required by code but granted to no role in `PERMISSION_GRANTS`).

Full endpoint list saved separately for reference: `docs/security-audit-2026-09-22/endpoint-inventory.txt` (221 routes, method + path + file:line).

### 3c. Active scan against the 4 public POST auth endpoints (properly seeded)

Since ZAP's spider can't discover POST-only JSON endpoints, they were seeded directly via a ZAP Automation Framework `requestor` job (`zap-plans/public-endpoints-plan.yaml`) — literal requests to `/api/auth/login`, `/api/auth/forgot-password`, `/api/auth/reset-password-with-token`, `/api/auth/activate-account`, plus `/api/health` and `/api/branding`, followed by a medium-strength/medium-threshold `activeScan`. **Tooling note:** this ZAP version (2.17.0)'s `requestor` job has a bug where the `headers` field fails to apply regardless of YAML syntax (scalar or block form) — worked around by omitting it; ZAP still correctly inferred and fuzzed the JSON body parameters (confirmed via the report's parameter capture, e.g. `({identifier,password})` on `/auth/login`) without an explicit `Content-Type` header, and 100% of responses came back `application/json`, confirming the server parsed the bodies correctly regardless.

**Result: 0 High, 0 Medium, 1 Low, 2 Informational — full alert list, no truncation:**
- Low: `X-Powered-By: Express` (same as R-04, confirmed again dynamically).
- Informational: missing `Cache-Control` directives on `/api/health` and `/api/branding` (both GET, low sensitivity — neither returns per-user/sensitive data).
- Informational: "User Agent Fuzzer" — tested alternate User-Agent strings against the 3 POST endpoints, found no behavioral difference (this is a clean/expected result, not a finding).

**No SQLi, XSS, command-injection, or other payload-based alert fired** against any of the 4 POST JSON-body endpoints under active scanning. This is genuine dynamic-testing evidence (not just a static-code read) corroborating that the input-validation layer (`class-validator` DTOs + global `ValidationPipe`) holds up under real attack traffic on these endpoints specifically.

**Not yet tested by this scan (deferred to Phase 5, by design):** actual brute-force/lockout behavior — ZAP's active scan sends varied payloads, not many identical repeated login attempts, so it wouldn't reliably trip a 5-attempt lockout on its own. That needs a dedicated, controlled test.

Full HTML report saved: `docs/security-audit-2026-09-22/zap-api-auth-endpoints-report.html`.

## Phase 4 — Burp Suite (manual)
*Pending — optional, depends on tooling available to the repo owner.*

## Phase 4 — Burp Suite
Installed and confirmed working (proxy listener `127.0.0.1:8080`, HTTP history capturing requests routed via `curl -x`). Used below for JWT/cookie inspection on a real login.

## Phase 5 — Authentication Audit

**A-01 — Rate limiting on `/auth/login` is active (contradicts prior report's V-04; appears fixed since 2026-09-19).**
- Evidence: live response headers on a real login — `X-Ratelimit-Limit: 10`, `X-Ratelimit-Remaining: 9`, `X-Ratelimit-Reset: 60`. `@nestjs/throttler` (`^6.7.0`) is a real dependency (confirmed in Phase 1) and is actively enforcing 10 req/60s on this endpoint right now, on the live deployment.
- Not yet verified: whether this coverage extends to the expensive endpoints the old report specifically flagged (reports/exports/PDF generation) — to check in Phase 8.

**A-02 — httpOnly auth cookie + double-submit CSRF (Medium — updates prior V-12). Now fully implemented end-to-end (backend AND frontend) and verified live in a real browser. FIXED, not yet committed.**

Original finding (as of the start of this session): login set an `httpOnly` cookie correctly, but `apps/web/src/api/client.ts`'s `apiFetch()` authenticated purely via `Authorization: Bearer <token>` read from `localStorage` and never sent `credentials: 'include'` — the cookie existed but was never actually used, so the access token remained fully exposed to any successful XSS via `localStorage`, identical to the original V-12 finding.

Backend work completed this session, in three parts:

1. **Cookie/CSRF infrastructure** — `esic_access_token`/`esic_platform_token`/`esic_refresh_token` httpOnly cookies (`apps/api/src/common/auth/auth-cookies.util.ts`), a `sameSite`/`secure` setting now conditional on `NODE_ENV` (`'none'`+`Secure` in production since the Vercel frontend and Railway API are cross-site by registrable domain; `'lax'`+non-`Secure` locally over plain HTTP), and a genuine double-submit CSRF check (`apps/api/src/common/middleware/security.middleware.ts`): a random `csrf` claim embedded in the JWT at issuance (`auth.service.ts`), returned once in the login/refresh response body, echoed back by the client as `X-CSRF-Token` on mutating requests, and verified server-side against the token's own embedded claim. This replaces the original `SameSite=Strict`-only design (which would have been genuinely CSRF-safe on its own, but broke the frontend entirely once the cross-site production topology was accounted for — `Strict`/`Lax` cookies are never attached to a cross-site request no matter what `credentials` mode the caller uses).
2. **A same-session regression found and fixed while testing this**: `TenantResolutionMiddleware` originally only ever read the `Authorization` header, so a cookie-only request reached `JwtStrategy.validate()` with no tenant context ever set, throwing `"No tenant context set"` as a 500. Fixed by having the middleware also fall back to the access/platform cookie. Caught by a new e2e spec (`apps/api/test/auth-cookie.e2e-spec.ts`), not by the existing suites (the unit suite mocks Prisma and never exercises this middleware; the existing e2e suite only ever used the header).
3. **A second, much bigger regression found while debugging (2) — see D-02-REGRESSION below.** The cookie-only e2e tests kept failing with a generic 401 even after (2)'s fix, for reasons that had nothing to do with cookies at all: this session's own D-02 dependency fix (commit `3f990a5`) had silently broken Express's entire route-matching layer, so *none* of `RequestIdMiddleware`, `cookie-parser`, `TenantResolutionMiddleware`, or `SecurityMiddleware` was running for any request — cookies were never even being parsed onto `req.cookies`. Fixing that (pin `path-to-regexp` to the exact patched `0.1.13` instead of an open `>=0.1.13` range) is what actually unblocked A-02, not anything in the cookie code itself.

**Backend verification:** `apps/api/test/auth-cookie.e2e-spec.ts` (6 tests: cookie set correctly on login, cookie-only auth succeeds with no `Authorization` header, no-token requests still 401, logout clears the cookie given a valid CSRF token, a cookie-authenticated mutating request with no/wrong `X-CSRF-Token` is rejected 403, and the cleared cookie is rejected on reuse) — all passing. Also reproduced end-to-end against a real local server via `curl` with a cookie jar (not just Jest mocks): login → cookie set → `GET /api/auth/me` cookie-only → `200`; `POST /api/auth/logout` cookie-only with no CSRF header → `403`; with the wrong CSRF value → `403`; with the correct value → `200`.

**Frontend migration, completed this session** (`apps/web/src/api/client.ts`, `apps/web/src/hooks/useAuth.ts`):

- `apiFetch()` now sends `credentials: 'include'` on every request (both the primary and dev-proxy-fallback `fetch()` calls), and no longer treats `explicitToken === null` the same as "no override" — that distinction matters for `logout()`'s root-session-revocation call during impersonation (below).
- `login()` no longer stores the raw access token anywhere JS can read it. A normal session's `token` is `null` in both React state and `localStorage`; only the one-time `csrfToken` from the login response body is kept, read back by `apiFetch()` (`getStoredCsrfToken()`) to attach `X-CSRF-Token` automatically on mutating cookie-authenticated requests. **Impersonation is unaffected by design** — an impersonation token is still stored and sent as an explicit `Authorization` header exactly as before (it's never cookie-set, carries no `csrf` claim, and doesn't need one, matching `auth.service.ts`'s existing design).
- Fixed four `!prev.token` guards (`enterHospital`, `exitHospital`, `clearMustChangePassword`, `startImpersonation`) that would otherwise have permanently no-op'd for every normal session once `token` became `null` by design — changed to guard on `!prev.user`/`!prev.mode` instead, which is what they actually meant.
- `logout()`'s impersonation branch (revoking the real administrator's session, not the impersonated target's) now correctly handles a cookie-only root session: `root.token` is `null` for a normal-session root (the common case since this migration), which `apiFetch` now honors as "rely on the root's own still-present httpOnly cookie" rather than incorrectly falling back to the *currently active* (impersonated) session's token. The root's own `csrfToken` is threaded through `OriginalSession` and passed as an explicit header for this one call, since the currently-stored CSRF value belongs to the impersonation session, not the root.
- Two raw `fetch()` calls that bypassed `apiFetch` entirely also needed `credentials: 'include'` added directly: the OPD display SSE stream (`apps/web/src/api/opd-display.api.ts`) and the patient-expense Excel export (`apps/web/src/api/ledger.api.ts`). A third, `apps/web/src/hooks/useAuth.ts`'s `postJson()` (used only for the login POST itself) — **this was the actual root cause of a second live bug, see A-02-REGRESSION below.**

**Frontend verification:** full Vitest suite (8 files / 39 tests, including the existing impersonation-chain tests, none of which needed behavior changes) passes unchanged. Live-tested end-to-end in a real Chrome browser (not curl, not mocked `fetch`) against the real local dev server: login → dashboard loads real data cookie-only (no `Authorization` header, no token ever in `localStorage`) → logout clears the session cleanly, no CSRF errors. `document.cookie` confirmed the access-token cookie is correctly invisible to JS (httpOnly), and `localStorage`'s `esic-hms-auth` blob confirmed to hold only `csrfToken`, never the real token, for a normal session.

**A-02-REGRESSION — the CSRF check itself could permanently 403-lock a user out of `/api/auth/login`, found live-testing A-02 in a real browser, not by curl or Jest (High, found and fixed this session, not yet committed).**

The very first real-browser login attempt after wiring up the frontend failed with `403 {"message":"Missing or invalid CSRF token."}` **on the login request itself** — reproducible on demand, not flaky. Root cause, found in two layers:

1. **The direct trigger**: `useAuth.ts`'s `postJson()` — a second, separate `fetch()` helper used only for the `/api/auth/login` POST, never routed through `apiFetch()` — never had `credentials: 'include'` added to it during the frontend migration above. Without it, the browser silently discards the login response's `Set-Cookie` header entirely (cross-origin, default `credentials: 'same-origin'`), so no cookie was ever actually stored client-side in the first place, no matter how correct the rest of the flow was. Confirmed by isolating the exact same login flow via raw `fetch()` calls in a scratch browser tab with and without `credentials: 'include'` explicitly set — only the version with it actually resulted in a cookie the browser would send back. **Fixed**: added `credentials: 'include'` to both of `postJson()`'s `fetch()` calls (primary and dev-proxy-fallback), matching `apiFetch()`.
2. **A second, independent, more serious bug this uncovered**: once (1) was fixed and a real session cookie was correctly established, a *second* login attempt (a second tab, or simply retrying) failed with the same 403 — this time because `SecurityMiddleware`'s CSRF check (`apps/api/src/common/middleware/security.middleware.ts`) applies to **every** mutating request with a cookie present and no `Authorization` header, with no exemption for `@Public()` routes like `/api/auth/login` itself. A user who already holds *any* still-valid access/platform cookie — from a second tab, or simply because their local session state got cleared while the server-side cookie was still within its 8h validity — has no CSRF token to send on a fresh login attempt (they're establishing a session, not proving one), so the check always rejects it. **This is a genuine denial-of-service against the login endpoint itself for anyone in that state**, and does not require an attacker at all — ordinary browser cookie persistence across tabs/reloads is enough to trigger it.

Reproduced directly against the live local server via `curl` (bypassing the frontend entirely, to isolate this from bug (1)): seed a valid cookie via one login, then attempt a second login while holding it, with no `X-CSRF-Token` header (correct, since the client has none to send yet) → `403`.

**Fixed**: added a small, explicit exemption list (`CSRF_EXEMPT_PATHS` in `security.middleware.ts`) for the five `@Public()` mutating routes in `auth.controller.ts` that never rely on the access/platform cookie to authenticate themselves — `/api/auth/login`, `/api/auth/refresh`, `/api/auth/forgot-password`, `/api/auth/reset-password-with-token`, `/api/auth/activate-account`. A genuinely authenticated mutating route (e.g. `/api/auth/logout`) still enforces the check exactly as before — confirmed by an explicit negative test.

**A third bug surfaced while writing the fix**: the exemption list initially matched against `req.path`, which turned out to always equal `"/"` at this exact point in the middleware chain (`consumer.apply(...).forRoutes('*')` mounts `SecurityMiddleware` such that `req.path`/`req.url` are relative to the mount point, not the real route — only `req.originalUrl` still carries the actual `/api/...` path here). The exemption silently matched nothing at all until switched to `req.originalUrl`. Found by directly instrumenting the middleware with a temporary debug log rather than guessing from the path field the `AllExceptionsFilter`'s error response happened to report (which is sourced differently and had already been showing a misleading `"path":"/"` in every CSRF-rejection response body from earlier in this session, a clue that went unrecognized until this specific investigation).

**Verification**: 7 new tests added to `security.middleware.spec.ts` (one per exempt path confirming no false 403 even with a stale valid cookie present, one confirming a non-exempt `/api/auth/*` route like logout still enforces the check, one explicit regression test asserting the exemption matches `originalUrl` and not `path`) — all passing, 16/16 total in that spec. Reproduced fixed end-to-end via `curl` (the same stale-cookie-then-login-again sequence that 403'd before now returns `200`) and in a real Chrome browser (full login → dashboard → logout cycle, clean, no CSRF errors, confirmed via server logs and network inspection).

**Lesson, same shape as D-02-REGRESSION**: this app now has two independent lightweight request-path/route decisions living outside NestJS's own routing/reflection layer (this CSRF exemption list, and `TenantResolutionMiddleware`'s own lightweight JWT decode) that have to be kept in sync BY HAND with the real `@Public()` decorators in the controllers, rather than reading that metadata directly the way `JwtAuthGuard` does via `Reflector`. That's a maintenance hazard worth flagging for anyone adding a new `@Public()` mutating auth endpoint in the future — nothing will fail loudly if `CSRF_EXEMPT_PATHS` isn't updated to match; it'll just quietly reintroduce this exact bug for that one new route. A follow-up worth considering (out of scope for this session): move the CSRF check into a real Nest guard that reads `@Public()` via `Reflector`, the same pattern `JwtAuthGuard` already uses, so the two can never drift apart.

**JWT structure (from a real platform-Super-Admin login, decoded):**
- Header: `{"alg":"HS256","typ":"JWT"}`.
- Payload: `{"sub":"<uuid>","email":"...","type":"platform","iat":...,"exp":...}` — `exp - iat = 28800s` (8h), matches cookie `Max-Age`. No `tokenVersion`, no embedded permissions/role beyond `type`.

**A-03 — Signature tampering correctly rejected (positive control).** Single-character flip in the signature → `401 "Authentication token invalid or expired"`, clean generic error.

**A-04 — No-token requests handled cleanly (positive control).** `401`, generic JSON body, no crash/stack trace.

**A-05 — Rate limiting is broader than login-only (updates A-01).** Two distinct tiers observed live: `/auth/login` = 10 req/60s, general authenticated routes (`/auth/me`) = 120 req/60s. The prior report's "no rate limiting anywhere" claim is now fully outdated.

**A-06 — Payload tampering correctly rejected (positive control).** Changed `"type":"platform"` → `"type":"hospital"` in the payload, re-encoded, kept the original signature → `401`. Confirms signature verification actually covers the full payload, not just a subset of claims — a forged/elevated claim can't slip through.

**Platform account identity shape:** `GET /auth/me` → `{"id":"...","identifier":"...","roleId":"","roleName":"SuperAdmin","type":"platform","permissions":[]}` — empty `roleId`/`permissions` consistent with the architecture note that `PlatformUser` has no role column (single global tier, no granular platform-side roles).

**No refresh token for platform sessions** — confirmed by design (`refreshTokens()` is hospital-staff-only per source comment in `auth.controller.ts`). Platform sessions are a flat 8h access token with no renewal path. Refresh-token behavior (V-02 territory: rotation, `tokenVersion` binding, reuse detection) needs a hospital-staff account to test — pending.

*(Lockout-threshold test and hospital-staff-specific auth behavior — pending a test hospital, see Phase 7 setup below.)*

## Phase 6 — Authorization / RBAC Audit
*Pending.*

## Phase 7 — Multi-Tenant Isolation Audit

### 7a. Blocking discovery: hospital onboarding is completely broken on staging, AND leaks internal error details (High — two linked findings)

While provisioning a test hospital to enable the actual isolation tests, `POST /api/platform/hospitals` returned `500` on every attempt (both hospitals tried), and the response body contained the **full raw Prisma error**: exact internal field names, enum types (`AuditStatus`, `AuditSeverity`), and query structure for the `AuditLog` model — effectively a verbatim schema dump.

**T-01 — Verbose error disclosure on 500s from service-thrown `InternalServerErrorException` (High, Confidence: Confirmed via live reproduction).**
- This directly contradicts what Phase 2 had confirmed as a positive control ("`AllExceptionsFilter` never leaks stack traces... in any environment") — that control is real for *unwrapped* errors, but has a gap.
- Root cause, verified in `apps/api/src/common/filters/all-exceptions.filter.ts:44-71`: the filter only substitutes a generic message when the exception has **no** `HttpException` response object (a bare/unwrapped `Error`). When a service explicitly wraps a caught error into `new InternalServerErrorException(\`...${err.message}\`)`, the filter treats that as the developer's *intended* client-facing message and passes it straight through verbatim — it has no way to distinguish "a deliberately-written message" from "an accidentally-interpolated raw internal error."
- **This exact anti-pattern exists in 3 places**, found via `grep -rn "InternalServerErrorException(\`[^\`]*\$\{"`: `modules/platform/hospitals.service.ts:197` (confirmed exploitable — just triggered), `modules/platform/hospitals.service.ts:252` (`resumeProvisioning`, same failure surface), `modules/employee/services/qr-code.service.ts:24` (QR generation failures).
- Impact: on failure, an attacker (or here, an authenticated Super Admin, but the *pattern* isn't permission-gated — any future consumer hitting these code paths gets it too) receives internal ORM/schema structure that materially aids further attacks (exact column names, model relationships, enum value sets).
- Fix: never interpolate `err.message`/`err.stack`/raw driver errors into an `HttpException`'s constructor message. Log the detail server-side (already done, correctly, via `this.logger.error`) and throw with a static, generic client-facing message instead. Consider a lint rule or a quick repo-wide grep as a recurring check, since this bypasses `AllExceptionsFilter`'s redaction by construction, not by a filter bug.

**T-02 — Hospital onboarding is functionally broken on this deployment (High, functional but audit-relevant — blocks tenant provisioning entirely).**
- Root cause, verified by comparing the live error against current source: `writeAuditLog()` (`account-lifecycle.service.ts:120-140`) sends exactly the correct Prisma input for the current `AuditLog` model (`actorUserId` has been a stable schema field, confirmed via `git log` — not a recent/breaking change). Since the **query is correct** but the **deployed Prisma Client rejects it as an unknown argument**, the deployed backend is running a **stale generated Prisma Client that doesn't match the current `schema.prisma`** — almost certainly a Railway build-cache issue where `prisma generate` didn't rerun for the current deploy (`package.json`'s `build`/`postinstall` scripts do call it correctly, so this looks like a deploy-pipeline/caching issue rather than a missing script).
- Practical consequence for this audit: **cross-tenant isolation testing (the rest of Phase 7) cannot proceed via new hospital provisioning until this is fixed.** Options: (a) trigger a clean Railway redeploy (clear build cache) and retry, (b) use pre-existing hospitals on this deployment if any exist, (c) test tenant isolation against local dev instead, where the Prisma Client is generated fresh on every `docker compose up --build`.
- Not a data-integrity risk today: the onboarding failure path does correctly clean up (drops the half-created schema, deletes the dangling `Hospital` row — verified in the same `catch` block, `hospitals.service.ts:188-195`), so failed attempts don't leave orphaned tenants behind.

**T-03 — `HospitalsService` never injected `TenantMigrationService`, despite calling it (High, functional, confirmed via `tsc`, now fixed).**
- `runMigrateDeploy()` (`hospitals.service.ts:266-271`, called by both `createHospital` and `resumeProvisioning` — i.e. the actual primary onboarding path) calls `this.tenantMigration.migrateTenantSchema(schemaName)`, but the constructor never declared `tenantMigration` as an injected dependency. Confirmed as a genuine, pre-existing TypeScript compile error on unmodified `main` (`git stash` + `tsc --noEmit` before touching anything): `error TS2339: Property 'tenantMigration' does not exist on type 'HospitalsService'`.
- **This does not match the live error we captured** (a Prisma validation error deep inside `provisionDefaultRoleAccounts`, several steps *after* `runMigrateDeploy` in the sequence) — if `this.tenantMigration` were really `undefined` at runtime, execution should never have gotten that far; it would throw a `TypeError` immediately at the migration step. This mismatch is itself informative: it means **the currently-deployed Railway build is running different code than the current `main` branch** — likely older, from before whatever refactor introduced this DI gap — reinforcing the T-02 stale-deployment theory rather than contradicting it. Both bugs needed fixing regardless, since current `main` (what any future deploy picks up) is broken either way.
- Fix applied: added `private readonly tenantMigration: TenantMigrationService` to the constructor (`TenantModule` is `@Global()` and already exports it — confirmed via `tenant.module.ts`, no module-wiring change needed). Verified `tsc --noEmit` now passes clean on `hospitals.service.ts`.

**Action taken:** Fixed T-01 (all 3 leak sites) and T-03 (missing DI) in commit `68c1687`.

**T-02 — actual root cause (superseding the stale-Prisma-Client theory above, which was disproven).**

The stale-client / Docker-caching theory was wrong. Disproven with direct evidence over several redeploys: `railway ssh` into the live container confirmed the deployed generated client genuinely includes `actorUserId` (26 matches in the real runtime file the app resolves, not just the `.d.ts`). The actual root cause, found via local reproduction (raw Prisma calls, the `AsyncLocalStorage` Proxy layer, and the `$use()` impersonation middleware each tested in isolation against a freshly-migrated schema):

`staff.service.ts`'s `createDefaultRoleAccounts()` passed `rolesCreated`, `rolesSkipped`, `rolesFailed`, and `requirePasswordChange` as top-level keys into `writeAuditLog()`'s `extra` parameter, which spreads directly into `prisma.auditLog.create()`'s `data` object — **none of those four keys are real columns on the `AuditLog` model.** Prisma's runtime validator, given an object mixing valid and genuinely-unknown keys, misattributes the resulting error to an unrelated valid field (`actorUserId`) instead of the actual offending keys, producing the misleading "Unknown argument `actorUserId`" message that sent this investigation toward schema/deploy infrastructure for a long time before a minimal local repro (bypassing NestJS entirely, then adding pieces back one at a time) isolated the real cause.

**Fix (commit `efd822b`):** nest the extra fields under `afterSnapshot`, the real `Json?` column already used for exactly this purpose by every other `writeAuditLog` call site in the same file. Verified end-to-end locally: `POST /api/platform/hospitals` → `201 Created`, all 13 default role accounts created successfully.

**Process note for this audit:** the debugging path here is worth being honest about — this took far longer than it should have because the error message pointed at a plausible-but-wrong culprit (`actorUserId`/schema generation), and several reasonable hypotheses (Docker layer caching, missing DI, stale deploy) were pursued and individually disproven with real evidence before the actual cause was found. Each ruled-out theory is left in this doc rather than deleted, since "what we checked and ruled out" is itself useful signal for anyone revisiting this.

**Confirmed fixed on the live deployment**: redeployed, `POST /api/platform/hospitals` → `201 Created`, verified for two separate hospitals (Hospital A6, Hospital B1), 13/13 role accounts created each time.

### 7b. Cross-tenant isolation tests (Hospital A6 vs Hospital B1, real accounts, live staging)

Provisioned two real hospitals, logged in as each Administrator (password changed from the onboarding default first, confirming `changePassword` correctly bumps `tokenVersion` and invalidates the prior token — required a re-login, as expected), then ran:

**F-01 — `x-hospital-id` header is correctly ignored for hospital-staff tokens (positive control, confirmed).** `GET /api/employees` with Hospital A's token returned identical results with and without an `x-hospital-id: <Hospital B's id>` header — both scoped to Hospital A only. Matches the documented design: this header only matters for platform-type tokens; hospital-staff tokens get their schema purely from the JWT's own `schemaName` claim, and the middleware doesn't let a client override that.

**F-02 — JWT `schemaName` tampering rejected (positive control, confirmed).** Modified `schemaName` from Hospital A's to Hospital B's schema in the payload, kept the original signature → `401 Unauthorized`. Same signature-integrity behavior already confirmed on the platform token in Phase 5, now confirmed specifically on the exact claim this app's tenant isolation actually depends on.

**F-03 — Direct cross-tenant record ID access (positive control, confirmed).** Took a real employee UUID from Hospital A, requested it while authenticated as Hospital B's Administrator (`GET /api/employees/<Hospital-A-employee-id>`) → `404 Not Found`. Confirms empirically, not just architecturally, that the schema-per-tenant model actually isolates data — Hospital B's Prisma client has no way to even see a row that lives in a different Postgres schema.

**No cross-tenant leak found** across header manipulation, token tampering, or direct ID guessing — the three most common real-world attack patterns against a multi-tenant system. This corroborates the prior report's independent conclusion that tenant isolation is soundly designed, now confirmed via live dynamic testing rather than code review alone.

*(Further Phase 7 tests — write-path isolation (POST/PATCH cross-tenant), refresh-token cross-tenant reuse, suspended-hospital token persistence (V-13 territory) — could extend this further if useful, but core read-path isolation is now solidly confirmed.)*

## Phase 8 — API Security
*Pending.*

## Phase 9 — Injection Testing
*Pending.*

## Phase 10 — File Upload Security
*Provisionally N/A — no upload subsystem found. Confirm in Phase 8.*

## Phase 11 — Security Headers / CORS / Cookies
*Pending.*

## Phase 12 — Dependency Security

`pnpm audit` across the whole monorepo: **68 findings (8 low, 31 moderate, 27 high, 2 critical)**. Scoped to `--prod` (excludes build/test-only tooling): **23 findings (2 low, 12 moderate, 9 high, 0 critical)** — this is the number that actually matters for a deployed-risk assessment.

**D-01 — Both critical findings are dev-only, not production-reachable (Informational).** Both are in `vitest` (`apps/web`'s test runner): RCE/arbitrary-file-read when Vitest's UI/API server is exposed to an untrusted network. Never shipped to the browser bundle or the deployed API; relevant only if someone runs `vitest --ui` with its port exposed publicly during local dev — worth a `vitest@4.1.11+` bump as routine hygiene, not an active production risk.

**D-02 — `path-to-regexp@0.1.12` ReDoS, production-reachable (Medium). FIXED, commit `3f990a5` — but see D-02-REGRESSION immediately below.** Pulled in transitively via `express@4.21.2` (itself via `@nestjs/platform-express`) — Express 4.x still bundles an old `path-to-regexp`. This is genuine production surface: Express uses it to compile every registered route into a matching regex. Exploitability is bounded by this being a developer-controlled route-pattern issue historically triggered by specific *route definition* shapes (not arbitrary user-supplied patterns) — this app's routes are all static, developer-written paths, not user-constructed, which meaningfully limits real exploitability here even though the vulnerable code is present. Fix path: needs an `@nestjs/platform-express`/Express major-version bump upstream, or a pnpm `overrides` pin to a patched `path-to-regexp`.

**D-02-REGRESSION — the D-02 fix itself silently disabled Express's entire route-matching layer, breaking every piece of app-level middleware (High, found this session while implementing A-02, not yet committed).**

The original `3f990a5` fix pinned the override as an *open range*: `"path-to-regexp@<0.1.13": ">=0.1.13"` (root `package.json`). pnpm resolved that range to whatever newer major version was already present elsewhere in the dependency graph — `path-to-regexp@3.3.0` — and force-substituted it into Express's own `require('path-to-regexp')`. Express 4's router is hard-coupled to the 0.x API (`pathToRegexp(path, keys, options)`); 3.x has an incompatible API and dropped support for bare `*` wildcards entirely. The practical effect: `AppModule`'s `consumer.apply(RequestIdMiddleware, cookieParser(), TenantResolutionMiddleware, SecurityMiddleware).forRoutes('*')` (`apps/api/src/app.module.ts`) silently stopped matching any route at all — **all four of those middleware silently stopped running, for every request, with no error, warning, or crash.**

Concretely, on an affected build: no `X-Request-Id` header, no security headers (`Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, etc. — every one of R-01/R-02's fixes, silently undone), `req.cookies` never populated (so `cookie-parser` effectively didn't run, which is what made A-02's cookie-only requests fail with a generic 401 — nothing to do with cookies, CSRF, or JWTs at all, just Express never handing the request to the code that would have parsed them), and no tenant-context resolution from a cookie-delivered token. Routes registered directly on controllers (not via module-level middleware) kept working normally, which is why the app appeared to function and only these specific cross-cutting concerns silently vanished — the kind of failure that's easy to miss entirely without deliberately checking for the *absence* of something.

**Root-cause confirmation:** `npm ls path-to-regexp` showed `path-to-regexp@3.3.0 invalid: "0.1.12" from express@4.21.2` — pnpm's own `invalid` flag on the resolution. Verified by instrumenting each middleware in the chain directly (`console.log` at the top of `RequestIdMiddleware.use()`, `TenantResolutionMiddleware.use()`, and `AppModule.configure()` itself): `configure()` ran and registered the chain correctly, but none of the middleware bodies ever executed for any request, including a plain `GET /api/health`.

**Fix:** pin to the exact patched version instead of an open range — `"path-to-regexp@<0.1.13": "0.1.13"` (`package.json`). `0.1.13` exists on the registry, is the CVE-patched release, and keeps the 0.x API Express 4 actually requires. After `pnpm install` + regenerating the Prisma client, `npm ls path-to-regexp` shows `path-to-regexp@0.1.13` cleanly satisfying Express's own `0.1.12` dependency (no `invalid` flag), and every header/cookie/tenant-context symptom above disappeared — confirmed via `curl -v` against a real running local server, and via the full `auth-cookie.e2e-spec.ts` suite (6/6 passing).

**Lesson for future dependency-override fixes:** an `overrides`/`resolutions` range like `>=X` is only safe when every consumer of that package is version-agnostic across the whole range. For a package a major framework vendors and hard-codes an API contract against (as Express does with `path-to-regexp` 0.x), always pin to the *exact* patched version, and add a quick smoke check (e.g. `npm ls <package>` showing no `invalid` line, plus one real end-to-end request) after any override change — a range that merely "satisfies semver" can still be a breaking major bump in practice.

**D-03 — `qs` DoS via attacker-controlled `isBuffer`, production-reachable (Low, explicitly DoS-class). FIXED, not yet committed.** Via `express`/`body-parser`'s bundled `qs` (`6.13.0`), used for query-string parsing on every request — actually three separate advisories against that version (an `arrayLimit` bypass via comma parsing, a bracket-notation `arrayLimit` bypass, and the `isBuffer` DoS this finding's title names), all patched by `6.16.0`. Fixed via a pnpm override pinned to the exact patched version (`"qs@<6.16.0": "6.16.0"`, same-major minor bump, not the cross-major-API-break risk `path-to-regexp` turned out to be for D-02 — see D-02-REGRESSION). Verified: full backend test suite (505/506, the one failure a pre-existing unrelated flake confirmed to pass in isolation) and the cookie-auth e2e suite (6/6) both pass unchanged after the bump.

**D-04 — `@remix-run/router`/`react-router` open redirect via protocol-relative URL (Low-Medium, frontend, shipped to the browser).** `apps/web`'s actual client-side router, `react-router-dom@6.28.1`. A same-origin redirect path starting with `//` can be reinterpreted as protocol-relative, pointing off-site — classic open-redirect/phishing vector. Real, shipped-to-users dependency; fix is a `react-router-dom` bump to pull in `react-router@6.30.4+`.

**D-05 — `multer` high-severity findings, but package is unused (Informational, not currently exploitable).** Confirmed via source grep: no `import ... from 'multer'` anywhere in `apps/api/src`, and not a direct dependency in either `package.json` — present only because `@nestjs/platform-express` lists it as an optional peer for apps that choose to use file uploads (this one doesn't, matching the "no file-upload subsystem exists yet" architecture note from Phase 1). Dead weight in the dependency tree; not a live risk today, but worth a `pnpm prune`/audit pass whenever an upload feature is actually built.

**D-06 — `brace-expansion` DoS, low practical reachability (Low). FIXED, not yet committed.** Originally flagged as reachable via `exceljs` (Excel import/export, e.g. employee bulk import) → `archiver`/`unzipper` → `glob` → `minimatch`; re-checking that exact chain this session (`npm ls exceljs --prod --all`) found `exceljs`'s own dependency tree no longer resolves through `glob`/`minimatch` at all in the current lockfile, so that specific path may already be moot — the packages remain present in the tree via other consumers regardless (`eslint`, `@typescript-eslint`, `jest`'s own `glob` dependency, and `@nestjs/*` packages' bundled `rimraf`/`glob` versions), several of which sit inside `apps/api`'s production dependency graph per `npm ls --prod` even though they're only ever actually invoked by dev/lint/test tooling. Two majors of `brace-expansion` were in active use (`1.1.16` and `2.1.2`, both below their patched thresholds); fixed via two pnpm overrides pinned to the exact patched version within each already-in-use major line (`"brace-expansion@1.x": "1.1.18"`, `"brace-expansion@2.x": "2.1.4"` — deliberately not a single blanket override, to avoid forcing any consumer across a major-version boundary the way the D-02-REGRESSION mistake did). A third major (`5.x`, via `rimraf@6.0.1 → glob@11.1.0 → minimatch@10.2.5`, only ever invoked by the root `clean` script) was left unpatched — genuinely dev-tooling-only with zero attacker-reachable surface, consistent with this finding's own original "low practical reachability" reasoning, and not worth adding a third override for. Verified: `npm ls brace-expansion` shows `1.1.18`/`2.1.4` resolved cleanly wherever those two majors are used; full backend and frontend test suites pass unchanged after the bump.

**Recommendation:** run `pnpm audit --prod` as a routine CI gate (not just this one-time check), prioritize D-02 (real production ReDoS surface) and D-04 (shipped-to-browser open redirect) first, and address the rest opportunistically via routine dependency bumps.

**STALE-DEPLOY — Railway production appears to be running a build older than commit `3f990a5` (Informational, new finding, this session).**

While verifying A-02/D-02-REGRESSION against production, `curl -sS -D - https://api-production-a838.up.railway.app/api/health` showed:

- `strict-transport-security`, `content-security-policy`, `x-content-type-options`, `x-frame-options`, `x-xss-protection` — all present (the *original*, pre-`3f990a5` header set from `SecurityMiddleware`).
- `x-request-id` — present (from `RequestIdMiddleware`) — meaning the D-02-REGRESSION bug described above was, fortunately, likely never actually live on this specific deployment, since this middleware chain is clearly running there.
- `x-powered-by: Express` **— still present**, and `referrer-policy`/`permissions-policy` **— absent**. Both were added in `3f990a5` (`app.disable('x-powered-by')`/`server.disable('x-powered-by')` in `main.ts`, plus the two new `res.setHeader()` calls in `security.middleware.ts`). Their absence indicates the currently-running production process predates that commit.

This means **R-02 is fixed in source but not confirmed live** — correct the earlier "FIXED" claim's practical meaning accordingly. It's worth finding out *why* the deploy didn't roll forward (a failed Railway build, a manual deploy step that wasn't re-triggered, a paused auto-deploy, etc.) before assuming anything merged this session — including this session's own A-02/D-02-REGRESSION fixes once committed — is actually protecting real traffic. Not independently exploitable on its own (it's a missing-hardening/stale-artifact issue, not a vulnerability introduced by the gap), but it undermines confidence in "fixed and pushed" claims for this deployment specifically, and is worth a deliberate redeploy-and-reverify step rather than assuming `git push` alone was sufficient.

## Phase 13 — Source Code Secret Scan

Grepped for common committed-secret patterns (AWS access keys, PEM private key headers, Stripe/GitHub/Slack tokens) across `apps/`: **zero matches.** Confirmed `.env` files are correctly gitignored and not tracked by git (`git ls-files` shows none beyond `.env.example`) — matches the prior report's confirmed-safe control, independently re-verified here.

## Phase 14 — Docker / Infrastructure
*Pending.*

## Phase 15 — TLS / HTTPS
*N/A for localhost scope — revisit only if a staging/production URL is ever brought into scope.*

## Phase 16 — Business Logic
*Pending.*

## Phase 17 — Finding Validation
*Pending — applied continuously as findings are logged.*

## Phase 18 — Severity Methodology
*CVSS-informed severity will be assigned per finding in Phase 17, not arbitrarily.*

## Phase 19 — Final Report
*Assembled last, from all phases above.*
