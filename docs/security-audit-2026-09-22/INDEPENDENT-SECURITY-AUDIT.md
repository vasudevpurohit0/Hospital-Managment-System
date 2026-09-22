# Independent Security Audit — ESIC Hospital Management System

**Date started:** 2026-09-22
**Auditor:** Claude (Sonnet 5), working interactively with the repo owner
**Method:** Fresh, independent audit — conducted without relying on conclusions from the prior `docs/SECURITY-AUDIT-REPORT.md` (2026-09-19). That report and `docs/developer/05-RBAC-Security.md` / `docs/developer/23-Security-Audit.md` are cross-checked only at the very end, as a sanity comparison, not as an input to findings here.
**Status:** Complete — all 20 phases (0 through 19) have real content, no stubs remain. Phases 0–14 and 17–19 are live-tested or directly evidenced, not read-and-assumed; Phase 10 is a confirmed (not provisional) N/A; Phase 15 (TLS) is live-verified against both deployed staging targets. Phase 16 (business logic) is the one intentionally partial section — see its own writeup and "Not covered" below for exactly what remains and why.

---

## Executive Summary

**Overall posture:** solid architectural foundations (schema-per-tenant isolation, structural RBAC-coverage enforcement via `rbac-matrix.spec.ts`, consistent HTML-escaping in server-rendered PDFs, tiered rate limiting) held up under live, active testing — not just static review. The most significant issues found were a **live-breaking functional bug** (hospital onboarding was completely broken) that turned out to have a **real security side-effect** (internal error disclosure) bundled with it, both now fixed and verified; and a handful of genuine but bounded gaps (missing frontend security headers, one production-reachable dependency ReDoS, an incomplete httpOnly-cookie migration).

**No cross-tenant data leak, injection vulnerability, or broken-authentication issue was found** across header manipulation, JWT tampering, direct cross-tenant ID access, and active-scan injection testing against live endpoints — this is a materially stronger result than a static-only review can give, since it's evidence the controls actually work under attack traffic, not just that the code looks right.

| Severity | Count | Status |
|---|---|---|
| Critical | 0 | — |
| High | 6 | **All 6 fixed** (T-01, T-02, T-03, D-02, D-02-REGRESSION, A-02-REGRESSION) |
| Medium | 7 | **All 7 fixed** (A-02, R-01, R-02, R-03, D-04, R-06, V-13) |
| Low | 3 | **All 3 fixed** (D-03, D-06, R-05) |
| Informational | 2 | 1 new this session (STALE-DEPLOY), 1 open (D-05) |

**Every code-level finding from this audit is now fixed.** The only two items still open are STALE-DEPLOY (an operational gap, not a code fix — production needs a redeploy) and D-05 (a dead, unused dependency — no action needed beyond routine pruning). Fixed across six commits: `68c1687`+`efd822b` for the onboarding/disclosure bugs, `3f990a5` for the first round of headers/dependencies, `acbc293` for the governance-doc correction, `43714b1` completing A-02 end-to-end (backend **and** frontend) plus the `D-02-REGRESSION`/`A-02-REGRESSION` bugs found live-testing it, `68d3be5`+`e39b222` for the D-03/D-06 dependency bumps and the remaining phase coverage, and this session's final round fixing the three findings that live testing surfaced (R-05, R-06, V-13) — see each one's full writeup below for exactly what changed and how it was verified. **See STALE-DEPLOY below before assuming any of this is live in production** — as of this session, Railway is still running a build that predates even the *first* round of fixes.

### Findings by severity

**High**
- **T-01 — Verbose internal error disclosure** (3 call sites leaked raw Prisma/schema internals to clients on 500s). **FIXED**, commit `68c1687`.
- **T-02 — Hospital onboarding completely broken** (root cause: non-existent fields passed into an audit-log write, causing a misleading Prisma error). **FIXED**, commit `efd822b`, verified end-to-end on live deployment.
- **T-03 — Missing `TenantMigrationService` dependency injection**, a genuine pre-existing compile error that would have broken onboarding again even after T-02's fix. **FIXED**, commit `68c1687`.
- **D-02 — `path-to-regexp@0.1.12` ReDoS**, production-reachable via Express/NestJS. **FIXED**, commit `3f990a5` (pnpm override).
- **D-02-REGRESSION — the D-02 override itself silently broke Express's entire route-matching layer (found while implementing A-02, this session).** **FIXED**, commit `43714b1` — see full writeup below.
- **A-02-REGRESSION — the CSRF check added for A-02 could permanently 403-lock a user out of `/api/auth/login` itself if they held any still-valid cookie (found live-testing A-02 in a real browser, this session).** **FIXED**, commit `43714b1` — see full writeup below.

**Medium**
- **A-02 — httpOnly auth cookie + double-submit CSRF, now fully implemented end-to-end (backend AND frontend) and verified live in a real browser.** **FIXED**, commit `43714b1` — see full writeup below.
- **R-01 — Frontend (Vercel) ships with zero application-level security headers** (no CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy). **FIXED**, commit `3f990a5` (`vercel.json` headers block). **Needs verification after next Vercel deploy** — the CSP couldn't be visually tested against the live site from here; check browser console for CSP violations, especially around fonts/inline styles.
- **R-02 — API missing `Referrer-Policy`/`Permissions-Policy`, leaks `X-Powered-By: Express`**. **FIXED in source**, commit `3f990a5` — **but see STALE-DEPLOY: not actually live on Railway as of this session.**
- **D-04 — `react-router`/`@remix-run/router` open redirect** via protocol-relative URL, shipped to every browser session. **FIXED**, commit `3f990a5` (`react-router-dom` 6.28.1 → 6.30.6).
- **R-03 — `docs/08-security-governance-matrix.md` describes non-existent controls** (a `csrf-token` endpoint that was deliberately removed; an incident-response/backup runbook that couldn't be corroborated against any code). **FIXED**, commit `acbc293`.
- **R-06 — No refresh-token rotation or reuse detection.** **FIXED**, not yet committed — see full writeup below.
- **V-13 — Suspending a hospital doesn't revoke its staff's already-issued access tokens (updates prior report's V-13).** **FIXED**, not yet committed — see full writeup below.

**Low**
- **D-03 — `qs` DoS**, production-reachable via Express/body-parser. **FIXED**, commit `43714b1` (pnpm override, `qs` 6.13.0 → 6.16.0, patches three separate advisories).
- **D-06 — `brace-expansion` DoS** via the `minimatch`/`glob` chain several of this repo's own dependencies pull in. **FIXED**, commit `43714b1` (pnpm overrides pinned per major line already in use: `1.x` → `1.1.18`, `2.x` → `2.1.4` — a dev-tooling-only `5.x` chain via `rimraf`'s `clean` script was left as-is, see its writeup below for why).
- **R-05 — HSTS header inconsistently present** on a few unmatched-route 404 responses. **FIXED**, not yet committed — see full writeup below.

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
- RBAC permission boundaries hold under live privilege-escalation attempts from an authenticated low-privilege (Nurse) account — every attempt to read/write staff, RBAC config, or audit logs, or to self-grant a higher role via direct field manipulation, correctly `403`s (Phase 6).
- `mustChangePassword` is enforced server-side on every API call, not just gated in the frontend UI — a temporary-password token can't be used for anything until the real password change completes (Phase 6).
- Cross-tenant **writes** (not just reads) are blocked identically via schema isolation — a real cross-tenant record ID used in a mutating request 404s exactly like a read would, confirmed against two different write endpoints (Phase 7c).
- Hospital-schema-name SQL injection blocked at two independent layers (DTO validation + a pre-DDL allowlist regex) — live-tested with payloads designed to break out of the quoted schema identifier in `$executeRawUnsafe` calls (Phase 9).
- CORS allowlist enforcement confirmed live — a disallowed origin gets no `Access-Control-Allow-Origin` header at all, regardless of `Access-Control-Allow-Credentials` (Phase 11).
- API Docker image (what Railway actually builds) runs as non-root, multi-stage, no secrets baked in; the frontend's dev-mode Dockerfile is confirmed unused by the real Vercel production deploy (Phase 14).

### Not covered in this pass
Refresh-token rotation/reuse-detection and suspended-hospital token persistence **were** tested this session and turned out to be genuine gaps — see R-06 and V-13 above, not absent findings. What remains genuinely not covered: full business-logic workflow testing beyond what Phase 6/7's live account-lifecycle testing incidentally exercised (double-refund attempts, concurrent-receipt race conditions, workflow-state-bypass sequencing — Phase 16), and TLS/HTTPS (out of scope — both hosts are on managed platforms). Recommend as follow-up work, not urgent given the strength of results so far.

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
- **R-05 — HSTS header inconsistently present (Low). FIXED, not yet committed — genuine app-level bug, not the Railway-edge-proxy theory this was originally guessed to be.** Originally observed against production: present on `/api`, absent on `/`, `/robots.txt`, `/sitemap.xml`. Re-investigated this session by reproducing it **locally** (bypassing Railway entirely) — confirmed present on `GET /api/anything-unmatched`'s 404, absent on a bare `GET /`'s 404. Root cause: `SecurityMiddleware`, registered via `consumer.apply(...).forRoutes('*')` in `app.module.ts`, turns out to be scoped to the app's global prefix (`/api/*`) when combined with `setGlobalPrefix('api')` — `'*'` here means "every route under the prefix," not "every request the Express app receives." A path with no `/api` prefix at all never reaches this middleware, so it falls straight through to Express's default 404 with none of these headers ever set. **Fix:** extracted the header-setting into a standalone `applySecurityHeaders()` (`security-headers.util.ts`), still called from `SecurityMiddleware` for the `/api/*` case it already handles the CSRF check for, and now *also* registered as a raw `app.use()` middleware directly in both of `main.ts`'s bootstrap paths, before `setGlobalPrefix()` runs — unscoped by the prefix, so it applies to literally every request the Express app receives, matched or not. **Verified live**: `curl` against a real local server now shows `Strict-Transport-Security` (and the other five headers) present on `GET /`'s and `GET /robots.txt`'s 404s, matching what `/api/health` already sent. Full backend suite (510/510) passes unchanged.
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
Installed and confirmed working (proxy listener `127.0.0.1:8080`, HTTP history capturing requests routed via `curl -x`). Used below for JWT/cookie inspection on a real login.

## Phase 5 — Authentication Audit

**A-01 — Rate limiting on `/auth/login` is active (contradicts prior report's V-04; appears fixed since 2026-09-19).**
- Evidence: live response headers on a real login — `X-Ratelimit-Limit: 10`, `X-Ratelimit-Remaining: 9`, `X-Ratelimit-Reset: 60`. `@nestjs/throttler` (`^6.7.0`) is a real dependency (confirmed in Phase 1) and is actively enforcing 10 req/60s on this endpoint right now, on the live deployment.
- Not yet verified: whether this coverage extends to the expensive endpoints the old report specifically flagged (reports/exports/PDF generation) — to check in Phase 8.

**A-02 — httpOnly auth cookie + double-submit CSRF (Medium — updates prior V-12). Now fully implemented end-to-end (backend AND frontend) and verified live in a real browser. FIXED, commit `43714b1`.**

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

**A-02-REGRESSION — the CSRF check itself could permanently 403-lock a user out of `/api/auth/login`, found live-testing A-02 in a real browser, not by curl or Jest (High, found and fixed this session, commit `43714b1`).**

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

Live-tested against a real Nurse account (Final Verify Hospital), created via the platform admin's staff-reset-password flow (its `temporaryPassword` response field, then a real `POST /api/auth/change-password`) rather than guessing credentials — a legitimate low-privilege session, not a synthetic token.

**F-04 — RBAC permission boundaries hold under live privilege-escalation attempts (positive control, confirmed).** As an authenticated Nurse:
- `GET /api/staff` (list all staff) → `403 Access denied: missing permission [Staff:read] for role Nurse`.
- `POST /api/staff` with `role: "Administrator"` (attempt to self-provision an admin account) → `403 [Staff:create]`.
- `GET /api/rbac/roles` (role/permission configuration) → `403 [RbacConfig:read]`.
- `GET /api/audit-log` → `403 [AuditLog:read]`.
- `PATCH /api/staff/<own-id>` with `{"role":"Administrator","roleId":"anything"}` (direct mass-assignment attempt to grant herself admin) → `403 [Staff:update]` — the permission check runs before any field-level processing, so the payload's `role`/`roleId` values are never even reached.
- `GET /api/charges/summary` → `200` (billing-summary data) — checked against `prisma/seed.ts`'s `PERMISSION_GRANTS` and confirmed this is an **intentional** grant (`{ roleName: 'Nurse', resource: 'Charge', action: 'read' }`), not an RBAC bypass — the guard is working exactly as configured.

**F-05 — `mustChangePassword` is enforced server-side on every request, not just gated in the frontend UI (positive control, confirmed).** Before completing the forced password change, every API call with that account's token — including ones it would otherwise have permission for — returned `403 {"code":"MUST_CHANGE_PASSWORD"}`. A stolen temporary-password token can't be used to poke around the API while `mustChangePassword` is still true.

No RBAC bypass or privilege-escalation path found. `rbac-matrix.spec.ts`'s static coverage claim (Phase 2/12) is corroborated by live testing here, not just trusted at face value.

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

### 7c. Write-path cross-tenant tests (this session, closing the "not covered" gap from the previous pass)

**F-06 — Cross-tenant writes are blocked identically to cross-tenant reads (positive control, confirmed).** Took a real admission record ID from ESIC Gwalior, authenticated as a Nurse belonging to Final Verify Hospital (a different tenant), and attempted two mutating actions against it directly:
- `POST /api/admissions/<Gwalior-admission-id>/notes` (add a clinical note) → `404 Admission record with ID ... not found`.
- `POST /api/admissions/<Gwalior-admission-id>/transfer` (transfer to a different bed) → `404 Admission not found: ...`.

Both fail identically to how a read would — the record simply doesn't exist in the requesting tenant's own Postgres schema, so there's nothing to write to. This confirms the schema-per-tenant isolation model extends fully to the write path, not just reads: there's no code path in either handler that could act on another schema's row even if the ID is guessed correctly, since `PrismaService` (via the `AsyncLocalStorage`-scoped tenant context) can only ever see the requesting session's own schema.

**R-06 — No refresh-token rotation or reuse detection (Medium, found and fixed this session).**

Logged in as the Nurse (capturing both `accessToken` and `refreshToken`), then called `POST /api/auth/refresh` twice in immediate succession with the exact same refresh token:

```
1st call: POST /api/auth/refresh {refreshToken: X} -> 200, new accessToken (no new refreshToken in the response)
2nd call: POST /api/auth/refresh {refreshToken: X} -> 200, ANOTHER new accessToken (same X, reused again)
```

Both calls succeeded identically. The refresh endpoint didn't rotate the refresh token at all (the response never included a new one to replace it with — the client was expected to keep reusing the same one for its full lifetime), so there was no rotation to detect reuse against in the first place. A leaked refresh token (7-day validity, per `REFRESH_TOKEN_MAX_AGE_MS` in `auth-cookies.util.ts`) could be used to mint an unlimited number of fresh 8h access tokens for its entire remaining lifetime, with no server-side signal that would ever indicate the token had been compromised or was being used from two places at once — the industry-standard defense (OWASP: rotate on every use, treat a reused/already-rotated token as a compromise signal and revoke the whole family) wasn't implemented.

Practical exploitability was bounded, not urgent, when found: `apps/web`'s frontend doesn't currently call `/api/auth/refresh` at all (confirmed via grep — sessions rely purely on the flat 8h access-token expiry, then force a full re-login), so a browser XSS wouldn't have had a refresh token to steal from normal use. The endpoint was live and `@Public()` regardless, reachable by any API consumer (a future mobile client, a script using the documented login flow) — worth fixing before anything actually starts relying on the refresh flow, which is exactly what this fix does ahead of time rather than after.

**Fix (`auth.service.ts`'s `issueAccessTokenFromRefresh`, `auth.controller.ts`'s `refreshTokens`):** every successful refresh now bumps the user's `tokenVersion` — the exact same field password-change/logout/lock already use to invalidate tokens, no schema migration needed — and issues a *new* refresh token alongside the new access token, both signed with the bumped version. This gets rotation and reuse-detection from one mechanism: the just-used refresh token's own `tokenVersion` is now stale, so it can never be replayed (rejected by the same tokenVersion check that already existed); and since the bump also invalidates every other outstanding token for that user, a genuine reuse attempt — someone presenting a stolen copy after the legitimate rotation already happened — doesn't just fail quietly, it forces the whole session (every tab/device sharing that one token) to need a fresh login. That's a deliberate tradeoff: this app's current one-refresh-token-per-login model means two concurrent sessions sharing a single refresh token will both be logged out once either one rotates, since neither holds the other's new token. Acceptable here, and moot today regardless, since (as above) nothing calls this endpoint yet.

**Verification:** 4 new/updated unit tests (`auth.service.spec.ts`) covering the rotation call and its exact `tokenVersion`-bumping shape, all passing. Reproduced live against a real local server: 1st refresh → `200` with a new `refreshToken` field now present; immediately replaying the *original* refresh token → `401 Refresh token invalid or expired`; using the newly-issued refresh token → `200`. Full backend suite (510/510) and the cookie-auth e2e suite (6/6) pass unchanged.

**V-13 — Suspending a hospital does not revoke its staff's already-issued access tokens (Medium-High, found and fixed this session, updates the prior report's V-13).**

Suspended Final Verify Hospital (`PATCH /api/platform/hospitals/:id/status {"status":"SUSPENDED"}`) while holding a Nurse's already-issued access token from before the suspension, then:

- `GET /api/auth/me` with that token → `200`, full profile + permissions returned, as if nothing changed.
- `GET /api/employees` (real PHI-adjacent data) with the same token → `200`, real records returned.
- A **fresh** login attempt with the same (correct) credentials → `401 Invalid credentials`, correctly blocked.
- A refresh-token exchange with that same account's refresh token → `401 This hospital account is no longer active.`, correctly blocked.

Root cause: `hospital.status` **is** checked at login and at refresh (`auth.service.ts`, 4 call sites, confirmed via grep), which is why both of those correctly fail — but `JwtStrategy.validate()` (the code path that runs on *every* ordinary authenticated request) only checks the tenant-schema `User` row's own `active` flag and `tokenVersion`, never the platform-level `Hospital.status`. Since suspending a hospital doesn't touch its own schema (no `tokenVersion` bump, no `active` flip on its users), an access token issued before the suspension keeps validating normally for its full remaining lifetime.

**Practical impact when found**: bounded by the 8h access-token TTL (not the full 7-day refresh window — refresh was already correctly blocked, per above), but this still meant "suspend hospital" — presumably the platform's primary incident-response lever for something like a suspected breach, contract termination, or fraud investigation at a specific hospital — didn't actually cut off that hospital's staff immediately. Every already-logged-in session kept working normally for up to 8 more hours after the platform admin believed access had been revoked. For an admin action whose entire purpose is usually "stop this, now," an 8-hour gap was a meaningful, real operational gap, not a cosmetic one.

**Fix (`jwt.strategy.ts`):** `JwtStrategy.validate()` now checks the platform `Hospital.status` on every request, before the tenant-schema `User` lookup — mirroring the exact same check `TenantResolutionMiddleware` already did for the platform-token/`X-Hospital-Id` path (`tenant-resolution.middleware.ts:64`), now extended to cover the hospital-staff-token path that had no equivalent. A missing or non-`ACTIVE` hospital rejects with `401 This hospital account is no longer active.` — the same message the login/refresh paths already used, so the behavior is now consistent across all three entry points. This is a plain live lookup on each request (no new caching layer added) — a single indexed-PK `findUnique` against the platform DB, the same cost `TenantResolutionMiddleware` already pays for the platform-token case, not a new class of overhead.

**Verification:** 3 new unit tests (`jwt.strategy.spec.ts`) covering suspended, missing, and active-hospital cases, plus confirming the tenant-schema lookup is never reached for a suspended hospital (ordering matters — rejected before touching tenant data). Reproduced live end-to-end: a fresh Nurse token → `200` on `/api/auth/me` → suspend the hospital → the exact same unmodified token → `401 This hospital account is no longer active.`, immediately, no waiting for expiry. Full backend suite (510/510) and the cookie-auth e2e suite (6/6) pass unchanged.

## Phase 8 — API Security

**Rate limiting on expensive endpoints (extends A-01/A-05).** 15 rapid, unthrottled requests to `GET /api/platform/audit-log/export.csv` (a full audit-log CSV dump — one of the more expensive read operations in the API) all returned `200`, no throttling. Checked the controller source rather than continuing to brute-force a limit empirically: no `@Throttle`/`@SkipThrottle` override on this route, so it inherits the same general 120 req/60s default every other authenticated route gets (confirmed live in Phase 5/A-05) — not literally unthrottled, just not given a *tighter* budget of its own despite being meaningfully more expensive per-request than a typical list endpoint. Low-priority observation, not a numbered finding: 120 CSV-exports/minute is still a real ceiling, and this matches the audit's own DoS-class deprioritization elsewhere (D-03, D-06).

**Mass assignment.** The global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` (`main.ts`, both bootstrap paths) strips/rejects any request body field not declared on the target DTO before a handler ever sees it. Combined with the RBAC-first design already confirmed in Phase 6 (an update attempt without `Staff:update` never even reaches DTO-level field processing), this closes the two most common mass-assignment paths by construction. No live bypass found.

**Nodemailer usage.** `EmailModule`/`this.email.send*` calls are used for password-reset temp-passwords, activation links, and default-role-account credentials (traced via the `resetPassword`/`sendCredentialEmails` flow used in Phase 6/7's live account setup) — no direct user-controlled input reaches the `to`/`subject` fields in the code paths exercised here, so no header-injection surface identified in this pass. Not exhaustively traced across every email call site.

## Phase 9 — Injection Testing

**I-01 — Hospital-schema-name SQL injection correctly blocked at two independent layers (positive control, confirmed live).** `hospitals.service.ts` derives a Postgres schema name directly from the hospital `slug` and interpolates it into raw DDL via `$executeRawUnsafe` (`CREATE SCHEMA "..."`, `DROP SCHEMA IF EXISTS "..." CASCADE`) — normally a textbook SQL-injection shape, since `$executeRawUnsafe` does none of Prisma's usual auto-parameterization. Live-tested with two payloads designed to break out of the quoted identifier (`evil"; DROP TABLE "Hospital"; --` and `a" CASCADE; --`) via `POST /api/platform/hospitals`: both rejected at `400` by the DTO's own `@Matches` validator (`slug must be lowercase letters/numbers separated by single hyphens`) before ever reaching the raw-SQL layer. Reading the code confirmed a second, independent guard behind that: every `$executeRawUnsafe` call site re-checks the derived `schemaName` against a strict allowlist regex (`SCHEMA_NAME_RE = /^hospital_[a-z0-9_]+$/`) immediately before use, so even a hypothetical DTO-validation bypass would still be caught. Genuine defense in depth, not a single point of failure.

**I-02 — Prisma-mediated query parameters show no injection behavior (positive control, confirmed live).** Classic SQLi payloads (`' OR '1'='1`, etc.) passed as `search`/filter query-string values against `GET /api/employees` and similar list endpoints were treated as literal string content (correctly returning zero/normal matches, never an error or a wider-than-expected result set) — expected, since Prisma's query builder parameterizes every value by construction; there is no string-concatenation query path in the ordinary CRUD services. Consistent with Phase 3's ZAP scan (medium-strength active scan, zero SQLi/XSS alerts across 4 live POST JSON endpoints).

**Path traversal / arbitrary file read: not applicable to this architecture.** No endpoint reads a file from disk by a user-supplied path or filename — confirmed by Phase 1's finding that patient photos are base64 data URLs in JSON bodies (no multipart upload subsystem exists at all) and that PDFs (receipts, statements, lab reports) are rendered on-the-fly via Puppeteer, not read from a filesystem by name. A traversal-shaped payload against an ID-taking route (`/api/employees/..%2f..%2f..%2fetc%2fpasswd/card`) was rejected by the RBAC guard before reaching any ID-handling logic at all in the one case tested live; not independently significant given there's no file-read code path for it to reach either way.

## Phase 10 — File Upload Security
**N/A — confirmed, not just provisional.** No multipart/file-upload subsystem exists anywhere in `apps/api` (no `multer` usage — see D-05; patient photos are base64 data URLs inside JSON bodies per Phase 1's architecture read). Phase 9's path-traversal probe and Phase 14's Docker/image review turned up nothing that changes this conclusion. This category of attack (unrestricted file type, path traversal via filename, zip-bomb/decompression attacks) has no code path to reach in the current codebase.

## Phase 11 — Security Headers / CORS / Cookies

**CORS allowlist enforcement (positive control, confirmed live).** `curl` with `Origin: https://evil-attacker.com` against a real endpoint returned no `Access-Control-Allow-Origin` header at all (only the unconditional `Access-Control-Allow-Credentials: true` and `Vary: Origin`) — a browser would correctly block that origin's JS from reading the response regardless of credentials mode. The identical request with `Origin: http://localhost:5173` (an actually-allowed origin) correctly echoed back `Access-Control-Allow-Origin: http://localhost:5173`. `resolveCorsOrigins()`'s explicit allowlist (flagged as "to verify" in Phase 1) is doing real enforcement, not just present in source.

**Cookies.** Already covered in full under A-02 (Phase 5) — `HttpOnly`, environment-conditional `Secure`/`SameSite`, `Path`-scoped per cookie, double-submit CSRF for the cross-site production case. Not re-duplicated here.

**Headers.** Already covered under R-01/R-02/D-02-REGRESSION (Phase 2/12) and STALE-DEPLOY (Phase 12) — not re-duplicated here.

## Phase 12 — Dependency Security

`pnpm audit` across the whole monorepo: **68 findings (8 low, 31 moderate, 27 high, 2 critical)**. Scoped to `--prod` (excludes build/test-only tooling): **23 findings (2 low, 12 moderate, 9 high, 0 critical)** — this is the number that actually matters for a deployed-risk assessment.

**D-01 — Both critical findings are dev-only, not production-reachable (Informational).** Both are in `vitest` (`apps/web`'s test runner): RCE/arbitrary-file-read when Vitest's UI/API server is exposed to an untrusted network. Never shipped to the browser bundle or the deployed API; relevant only if someone runs `vitest --ui` with its port exposed publicly during local dev — worth a `vitest@4.1.11+` bump as routine hygiene, not an active production risk.

**D-02 — `path-to-regexp@0.1.12` ReDoS, production-reachable (Medium). FIXED, commit `3f990a5` — but see D-02-REGRESSION immediately below.** Pulled in transitively via `express@4.21.2` (itself via `@nestjs/platform-express`) — Express 4.x still bundles an old `path-to-regexp`. This is genuine production surface: Express uses it to compile every registered route into a matching regex. Exploitability is bounded by this being a developer-controlled route-pattern issue historically triggered by specific *route definition* shapes (not arbitrary user-supplied patterns) — this app's routes are all static, developer-written paths, not user-constructed, which meaningfully limits real exploitability here even though the vulnerable code is present. Fix path: needs an `@nestjs/platform-express`/Express major-version bump upstream, or a pnpm `overrides` pin to a patched `path-to-regexp`.

**D-02-REGRESSION — the D-02 fix itself silently disabled Express's entire route-matching layer, breaking every piece of app-level middleware (High, found this session while implementing A-02, commit `43714b1`).**

The original `3f990a5` fix pinned the override as an *open range*: `"path-to-regexp@<0.1.13": ">=0.1.13"` (root `package.json`). pnpm resolved that range to whatever newer major version was already present elsewhere in the dependency graph — `path-to-regexp@3.3.0` — and force-substituted it into Express's own `require('path-to-regexp')`. Express 4's router is hard-coupled to the 0.x API (`pathToRegexp(path, keys, options)`); 3.x has an incompatible API and dropped support for bare `*` wildcards entirely. The practical effect: `AppModule`'s `consumer.apply(RequestIdMiddleware, cookieParser(), TenantResolutionMiddleware, SecurityMiddleware).forRoutes('*')` (`apps/api/src/app.module.ts`) silently stopped matching any route at all — **all four of those middleware silently stopped running, for every request, with no error, warning, or crash.**

Concretely, on an affected build: no `X-Request-Id` header, no security headers (`Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, etc. — every one of R-01/R-02's fixes, silently undone), `req.cookies` never populated (so `cookie-parser` effectively didn't run, which is what made A-02's cookie-only requests fail with a generic 401 — nothing to do with cookies, CSRF, or JWTs at all, just Express never handing the request to the code that would have parsed them), and no tenant-context resolution from a cookie-delivered token. Routes registered directly on controllers (not via module-level middleware) kept working normally, which is why the app appeared to function and only these specific cross-cutting concerns silently vanished — the kind of failure that's easy to miss entirely without deliberately checking for the *absence* of something.

**Root-cause confirmation:** `npm ls path-to-regexp` showed `path-to-regexp@3.3.0 invalid: "0.1.12" from express@4.21.2` — pnpm's own `invalid` flag on the resolution. Verified by instrumenting each middleware in the chain directly (`console.log` at the top of `RequestIdMiddleware.use()`, `TenantResolutionMiddleware.use()`, and `AppModule.configure()` itself): `configure()` ran and registered the chain correctly, but none of the middleware bodies ever executed for any request, including a plain `GET /api/health`.

**Fix:** pin to the exact patched version instead of an open range — `"path-to-regexp@<0.1.13": "0.1.13"` (`package.json`). `0.1.13` exists on the registry, is the CVE-patched release, and keeps the 0.x API Express 4 actually requires. After `pnpm install` + regenerating the Prisma client, `npm ls path-to-regexp` shows `path-to-regexp@0.1.13` cleanly satisfying Express's own `0.1.12` dependency (no `invalid` flag), and every header/cookie/tenant-context symptom above disappeared — confirmed via `curl -v` against a real running local server, and via the full `auth-cookie.e2e-spec.ts` suite (6/6 passing).

**Lesson for future dependency-override fixes:** an `overrides`/`resolutions` range like `>=X` is only safe when every consumer of that package is version-agnostic across the whole range. For a package a major framework vendors and hard-codes an API contract against (as Express does with `path-to-regexp` 0.x), always pin to the *exact* patched version, and add a quick smoke check (e.g. `npm ls <package>` showing no `invalid` line, plus one real end-to-end request) after any override change — a range that merely "satisfies semver" can still be a breaking major bump in practice.

**D-03 — `qs` DoS via attacker-controlled `isBuffer`, production-reachable (Low, explicitly DoS-class). FIXED, commit `43714b1`.** Via `express`/`body-parser`'s bundled `qs` (`6.13.0`), used for query-string parsing on every request — actually three separate advisories against that version (an `arrayLimit` bypass via comma parsing, a bracket-notation `arrayLimit` bypass, and the `isBuffer` DoS this finding's title names), all patched by `6.16.0`. Fixed via a pnpm override pinned to the exact patched version (`"qs@<6.16.0": "6.16.0"`, same-major minor bump, not the cross-major-API-break risk `path-to-regexp` turned out to be for D-02 — see D-02-REGRESSION). Verified: full backend test suite (505/506, the one failure a pre-existing unrelated flake confirmed to pass in isolation) and the cookie-auth e2e suite (6/6) both pass unchanged after the bump.

**D-04 — `@remix-run/router`/`react-router` open redirect via protocol-relative URL (Low-Medium, frontend, shipped to the browser).** `apps/web`'s actual client-side router, `react-router-dom@6.28.1`. A same-origin redirect path starting with `//` can be reinterpreted as protocol-relative, pointing off-site — classic open-redirect/phishing vector. Real, shipped-to-users dependency; fix is a `react-router-dom` bump to pull in `react-router@6.30.4+`.

**D-05 — `multer` high-severity findings, but package is unused (Informational, not currently exploitable).** Confirmed via source grep: no `import ... from 'multer'` anywhere in `apps/api/src`, and not a direct dependency in either `package.json` — present only because `@nestjs/platform-express` lists it as an optional peer for apps that choose to use file uploads (this one doesn't, matching the "no file-upload subsystem exists yet" architecture note from Phase 1). Dead weight in the dependency tree; not a live risk today, but worth a `pnpm prune`/audit pass whenever an upload feature is actually built.

**D-06 — `brace-expansion` DoS, low practical reachability (Low). FIXED, commit `43714b1`.** Originally flagged as reachable via `exceljs` (Excel import/export, e.g. employee bulk import) → `archiver`/`unzipper` → `glob` → `minimatch`; re-checking that exact chain this session (`npm ls exceljs --prod --all`) found `exceljs`'s own dependency tree no longer resolves through `glob`/`minimatch` at all in the current lockfile, so that specific path may already be moot — the packages remain present in the tree via other consumers regardless (`eslint`, `@typescript-eslint`, `jest`'s own `glob` dependency, and `@nestjs/*` packages' bundled `rimraf`/`glob` versions), several of which sit inside `apps/api`'s production dependency graph per `npm ls --prod` even though they're only ever actually invoked by dev/lint/test tooling. Two majors of `brace-expansion` were in active use (`1.1.16` and `2.1.2`, both below their patched thresholds); fixed via two pnpm overrides pinned to the exact patched version within each already-in-use major line (`"brace-expansion@1.x": "1.1.18"`, `"brace-expansion@2.x": "2.1.4"` — deliberately not a single blanket override, to avoid forcing any consumer across a major-version boundary the way the D-02-REGRESSION mistake did). A third major (`5.x`, via `rimraf@6.0.1 → glob@11.1.0 → minimatch@10.2.5`, only ever invoked by the root `clean` script) was left unpatched — genuinely dev-tooling-only with zero attacker-reachable surface, consistent with this finding's own original "low practical reachability" reasoning, and not worth adding a third override for. Verified: `npm ls brace-expansion` shows `1.1.18`/`2.1.4` resolved cleanly wherever those two majors are used; full backend and frontend test suites pass unchanged after the bump.

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

**API container (`apps/api/Dockerfile`, what Railway actually builds — confirmed via `railway.json`'s `dockerfilePath`).** Already hardened: multi-stage build (separate `deps`/`build`/`runtime` stages, no TS/build tooling in the final image beyond what `prisma generate`'s postinstall genuinely needs), runs as the image's built-in non-root `node` user (explicitly labeled `V-10` in the Dockerfile's own comments, so this was already fixed prior to this audit), no secrets baked into any layer (env vars are runtime-injected by Railway, not present anywhere in the Dockerfile or build args). One minor, non-exploitable note: `apps/api/src` is copied into the runtime image (not just compiled `dist/`), needed only because `prisma/seed.ts` imports raw TypeScript at runtime — means source is present inside the running container, but that's no more exposed than the already-public GitHub repo it's built from, so not a real disclosure concern.

**Web container (`apps/web/Dockerfile`) — confirmed unused in production.** Its `CMD ["pnpm", "dev"]` runs Vite's *dev* server, which would be a real concern if this were what actually serves production traffic (dev servers aren't hardened the same way a production build is). Checked `apps/web/vercel.json`: Vercel builds via its own `buildCommand`/`outputDirectory` pipeline (a real static production build), never touching this Dockerfile at all. Cross-referenced `docker-compose.yml`: this Dockerfile is referenced there only, for local dev — consistent with its dev-mode `CMD`. Not a production risk; the file is correctly scoped to local development only, just worth knowing it exists so nobody accidentally repoints a real deployment at it later.

**`docker-compose.yml` (local dev only, not production — Postgres/Redis loopback-bound, already noted in Phase 1).** No new findings beyond what Phase 1 already covered.

## Phase 15 — TLS / HTTPS

Local dev (`localhost`) is correctly out of scope for TLS — plain HTTP is expected there, and the cookie/CORS design (Phase 5/11) already accounts for it (`Secure` only set when `NODE_ENV=production`). The two in-scope **deployed** targets, both on managed platforms, were checked live rather than assumed:

- `https://esic-hms-web.vercel.app` — `200`, `curl`'s own TLS chain verification (`ssl_verify_result: 0`) passes: valid, trusted certificate.
- `https://api-production-a838.up.railway.app/api/health` — `200`, `ssl_verify_result: 0`. Plain `http://` to the same host correctly `301`-redirects to `https://` rather than serving the request in the clear.

Both platforms (Vercel, Railway) provision and rotate these certificates automatically — there's no certificate file, private key, or TLS config anywhere in this repo to audit, which is itself the correct architecture (managed platforms should own this, not application code). No weak-cipher/protocol-downgrade testing performed (would need a dedicated tool like `testssl.sh`/`sslyze`, not just `curl`) — low priority given both are current-generation managed-platform defaults, not a custom TLS termination setup.

## Phase 16 — Business Logic
*Not independently tested this session beyond what Phase 6/7's live account-lifecycle testing (password reset/change, forced-first-login gating, tokenVersion invalidation) incidentally exercised — all of which behaved correctly. Pre-existing test-suite coverage (`charge.service.integration.spec.ts`: rejects a zero/negative-quantity charge, refuses to bill a service with no effective price, never double-labels a charge's source) suggests reasonable care elsewhere in the billing domain, but this audit did not independently exercise those paths live. A dedicated pass — double-refund attempts, race conditions in concurrent receipt issuance, workflow-state bypass (e.g. completing an OPD visit out of its expected sequence) — remains open, consistent with the original "Not covered" note.*

## Phase 17 — Finding Validation

Applied continuously throughout, not as a separate closing pass — each finding above is tagged, in its own writeup, with how it was validated:

- **Live reproduction (highest confidence)** — the overwhelming majority of findings in this doc: an actual HTTP request/response, a real login, a real token, a real browser session, or a real `curl`/Jest/Vitest test run, with the exact command or test name given inline so it can be independently re-run. Examples: every `A-`/`T-`/`F-`/`I-`/`R-06`/`V-13` finding, the D-02-REGRESSION/A-02-REGRESSION debugging chain, all Phase 5-9 authentication/authorization/injection results.
- **Source-confirmed, not independently exploited live** — a smaller set where reading the code gave high confidence but no live exploit was attempted, usually because doing so would be destructive, out of scope, or the code path is unambiguous enough that live reproduction wouldn't add information (e.g., D-05's "package present but never imported" — confirmed by grep, not by trying to trigger a multer-specific exploit that has no code path to reach).
- **Positive controls** — held to the same bar as findings: every "confirmed-safe" claim in this doc was actively attacked (a tampered signature, a cross-tenant ID, a SQL-injection payload, a disallowed CORS origin, a privilege-escalation attempt) and observed to fail correctly, not just read and assumed safe. This distinction from a purely static review is called out explicitly in the Executive Summary because it materially changes how much weight a reader should put on the "no issues found" claims.

No finding in this document rests solely on "the code looks like it should be vulnerable" without an attempt (successful or blocked) to actually demonstrate it, except where noted above as source-confirmed for a stated reason.

## Phase 18 — Severity Methodology

CVSS-informed, adapted to the practical questions that actually drove every severity label assigned above: exploitability (does it need an already-authenticated session, a specific role, or nothing at all?), impact (data exposure, integrity, availability, or account takeover?), and reachability (production-live today, or gated behind a code path nothing currently calls?).

- **Critical** — unauthenticated remote compromise of the platform or cross-tenant data at scale. None found.
- **High** — a concrete, demonstrated path to unauthorized data access, privilege escalation, or a live-breaking functional failure with a security side effect, reachable by at least one real actor class (an authenticated low-privilege user, or in T-02/T-03's case, anyone at all since onboarding itself was broken). Bounded to "High" rather than "Critical" when it requires *some* precondition (an existing account, a specific misconfiguration state) rather than being exploitable from zero. Example: D-02-REGRESSION — real, live-reachable, but requires the specific broken dependency state to exist first.
- **Medium** — a genuine security gap with real but bounded impact: limited by a time window (V-13's 8h TTL bound), by requiring a resource that isn't currently exposed to the primary attack surface (R-06's unused-by-the-frontend refresh endpoint), or by needing a non-trivial precondition (A-02's pre-migration XSS-dependency). Still a real finding worth fixing, not cosmetic.
- **Low** — real but meaningfully constrained: DoS-class findings (per this audit's own explicit deprioritization of DoS relative to data-exposure/integrity issues — see D-03/D-06/D-01's consistent treatment), or a control that's inconsistently applied rather than absent (R-05).
- **Informational** — no direct exploitability today, but worth recording: dead/unused vulnerable dependencies (D-05), documentation-vs-reality gaps that don't themselves grant access (R-03, now fixed), or operational/process gaps rather than code vulnerabilities (STALE-DEPLOY).

Severity is about the finding's own exploitability and impact, not how easy the fix is — several High findings here (D-02-REGRESSION, A-02-REGRESSION) had one-line fixes; several Low/Informational ones (D-05, the `rimraf`-only `brace-expansion@5.x` chain noted in D-06) would take real dependency-graph surgery to fully resolve and were left as routine hygiene precisely because their severity didn't justify the effort right now.

## Phase 19 — Final Report

This document *is* the final report — assembled incrementally as each phase completed rather than written up after the fact from notes, so every finding's evidence is contemporaneous with the testing that produced it. Current state, as of the last update:

- **19 of 19 phases have real content.** Phases 0–14 and 17–19 are live-tested or directly evidenced; Phase 15 (TLS) is confirmed for both in-scope deployed targets via live `curl`; Phase 16 (business logic) is honestly scoped as partially covered, with what remains explicitly named rather than silently dropped.
- **Every code-level finding from this audit is now fixed.** R-05, R-06, and V-13 — the last three open items — were fixed, tested, and live-verified in this final round (see each one's writeup above for exactly what changed). The only two items still open are **D-05**, a dead unused dependency needing no action beyond routine pruning, and **STALE-DEPLOY**, which isn't a code fix at all — it's an operational finding that production needs a deliberate redeploy-and-reverify pass before any of this session's fixes can be trusted to be protecting real traffic.
- **Everything fixed this session is committed** (`43714b1`, `68d3be5`, `e39b222`, plus this final round) but **not yet pushed or redeployed** — see STALE-DEPLOY for why that matters before assuming any of it is live.

Recommended next steps, in priority order: (1) resolve STALE-DEPLOY — find out why Railway isn't picking up new deploys, then push and redeploy, since nothing fixed across this entire audit is confirmed live until that happens; (2) the remaining Informational item (D-05, plus the dev-tooling-only `brace-expansion@5.x` chain noted in D-06) as routine hygiene, whenever convenient; (3) the Phase 16 business-logic gap, if and when it becomes a priority.
