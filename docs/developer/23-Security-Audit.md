# 23 — Security Audit (VERIFIED findings — DOCUMENTED ONLY, nothing fixed)

## CRITICAL

- **C1 — Predictable seed credentials in repo.** `apps/api/prisma/seed.ts:694-913` hashes 13 role passwords
  (`SuperAdminSecret123!`, `DoctorPass123!`, …) with bcrypt-10 and commits the plaintexts.
  Any seeded/shared environment using them is compromised by default. ROTATE on first login; never seed prod.
- **C2 — Compiled-in JWT fallback secrets.** `dev_jwt_access_secret_key_12345` /
  `dev_jwt_refresh_secret_key_67890` default in `auth.service.ts:96-103,122,149-152` and
  `jwt.strategy.ts`. `docker-compose.yml` does not set them → dev stack signs tokens with public constants.
  Forgery possible wherever defaults reach a shared env.
- **C3 — Frontend-visible API defaults** (`VITE_API_URL=http://localhost:3000`) + `enableCors()` with no
  origin allowlist (`main.ts:24,54`) — misconfiguration-prone when deployed behind a real host.

## HIGH

- **H1 — Default-allow guard.** `RbacGuard` returns `true` when a handler has no `@Roles`/`@RequirePermission`
  (`rbac.guard.ts:22-25`). One missing decorator = open endpoint. Mitigated by `rbac-matrix.spec.ts`
  conformance test — keep it blocking in CI and never add allowlist entries casually.
- **H2 — CSRF fallback accepts Bearer-only.** `security.middleware.ts:27-36` skips CSRF when `Authorization`
  present; token-in-`localStorage` + permissive CORS + no `httpOnly` cookie split weakens the control.
  No `csrf-token` issuance endpoint (`/auth/csrf-token` referenced but NOT VERIFIED present).
- **H3 — `GET /users` gated on `Admission:update`.** Any AdmissionDesk-holder lists users (`user.controller.ts`).
  Over-broad read; re-gate to an admin resource.
- **H4 — Excel import validation gaps.** `inventory/.../import/validate|confirm` + `excel/` utils exist but
  server-side schema/size/row-cap/content-scan behaviour was NOT fully traced — treat uploads as untrusted
  until a validation spec is documented; unrestricted fills could exhaust DB/job resources.
- **H5 — Hard deletes for wards/beds** (`DELETE /admissions/wards/:id|/beds/:id`) with no traced guard against
  occupied-bed deletion — confirm FK/`BedStatus` protection before exposing broadly.

## MEDIUM

- **M1 — Generic-but-chatty auth errors + timing.** Messages are generic (good), but DB-error vs credential-error
  paths differ (`ServiceUnavailable` branch, `auth.service.ts:41-47`) — user-enumeration/oracle risk under load.
- **M2 — Audit entity inference is heuristic.** `audit.interceptor.ts:33-38` derives `entityType` from URL
  segments; charge-controller absolute paths (`/patients/…/ledger`) may mislabel audit rows. `entityId` falls
  back to a zero-UUID (`:47-50`) — traceability gaps for some actions.
- **M3 — Broad `GET /dashboard/summary` gate** (`Employee:read`) exposes aggregates to many roles; confirm
  no PHI-level row detail leaks through it.
- **M4 — Stateless tokens without revocation.** Deactivation enforced at validate/refresh, but outstanding
  access tokens live up to 8h. No `logout-all-sessions`/token-version found (spec claims it — NOT VERIFIED).
- **M5 — MFA/password-policy/lockout/breach-check/session-limit: NOT VERIFIED** (docs claim; no code found).

## LOW / INFORMATIONAL

- Security headers set (HSTS/CSP `default-src 'self'`/nosniff/DENY/XSS-block — `security.middleware.ts:7-12`);
  CSP has no `unsafe-inline` exception (good) — verify no screen depends on inline scripts.
- `ValidationPipe{whitelist, forbidNonWhitelisted, transform}` global (good); IDOR coverage depends on
  per-service ownership checks — NOT systematically traced (assume absent until verified per endpoint).
- Sensitive logging: no password/PHI logging found in auth/audit paths (good); `photoUrl` (base64 JPEG) travels
  in registration payloads — confirm size limits + storage handling.
- `.env` files exist in workspace (`apps/api/.env`, `.api-dev.log`, `.web-dev.log`) — never commit real secrets;
  `.gitignore` must cover them (verify before push).
