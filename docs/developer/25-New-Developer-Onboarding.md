# 25 — New Developer Onboarding (START HERE)

## 1. What this project does

Labour-Department employees get one permanent Hospital UID + QR card; all OPD, consultation, lab,
pharmacy, therapy, IPD, billing, inventory and procurement events hang off it. Read `01-Project-Overview.md`
then the map in `26-End-to-End-System-Map.md`.

## 2–4. Architecture, repo, install

Architecture: `02-System-Architecture.md`. Layout: `03-Repository-Structure.md`.
Install: Node 20 + pnpm 9.15.4 → `pnpm install` → `npx prisma generate` → `migrate deploy` → `db seed`
→ `pnpm dev`. Docker alternative: `docker compose up` (note pg host port **5433** vs local **5432** — `20-Deployment.md`).

## 5–7. Configure, database, run

Copy `.env.example`; set `DATABASE_URL`, `REDIS_URL`, **real** `JWT_*_SECRET`s.
Prisma schema: `apps/api/prisma/schema.prisma` (57 models — tour in `04-Database-Architecture.md`).
API `:3000` (`/api/health` smoke), web `:5173` (Vite proxies `/api`).

## 8–10. Auth, RBAC, finding a module

Login: identifier + password → Bearer access (8h) → `useAuth` stores `esic-hms-auth` (`06-Authentication.md`).
Authorization: `PERMISSION_GRANTS` (seed) + `RbacGuard` (only SuperAdmin bypasses) — full matrix in `05-RBAC-Security.md`.
Find a module: `app.module.ts` imports → `modules/<domain>/{controller,service,module,dto}` → schema models
in `04` → screens in `18` → endpoints in `17`.

## 11–13. Trace an API / a DB record / billing

API: screen `api/*.api.ts` call → controller prefix + `/api` → guard/permission → service → Prisma.
DB record: `Visit.employeeId` → `ChargeItem.visitId` → `Receipt`; `MedicineBatch` → `StockTransaction`.
Billing: activity → `PricingService.resolve` (or batch price) → `ChargeItem(PENDING, discount 0, cites price)`
→ ledger → receipt → PAID (`13-Billing-Ledger-Payments.md`).

## 14–17. Tests, debug, deploy

`pnpm lint`, `pnpm typecheck`, backend `test` / `test:e2e` (needs DB+Redis), web `vitest` (`21-Testing.md`).
Debug: `AllExceptionsFilter` shape `{statusCode,error,message}`; `extractErrorMessage` joins DTO errors;
`No effective price` → price the service; CSRF 403 on mutation → check Bearer attach.
Deploy: dev compose only — no prod manifest exists; build with `turbo run build` and read `20-Deployment.md` honestly.

## 18. Do NOT change casually

`ChargeService` arithmetic, `PricingService.resolve`, FEFO query filter, expiry transitions,
bed-allocate transaction, discharge gate, `DocumentSequence` formats, `PERMISSION_GRANTS`,
migrations, seed role names. Each is load-bearing for money, safety, or audit.

## 19–20. Risks & truth

Known risks: `23-Security-Audit.md` (rotate seed creds + JWT secrets first) and `24-Technical-Debt-Risks.md`.
Source of truth order: **code/schema → this package → `docs/00–08` (intent) → manuals (reference)**.
