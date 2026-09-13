# 03 — Repository Structure (VERIFIED)

## Root (`ESIC/`)

| Path | What belongs there |
|---|---|
| `apps/api/` | NestJS backend (see below) |
| `apps/web/` | React frontend (see §18) |
| `docs/00–08` | Intent briefs (reference — NOT the implementation record) |
| `docs/developer/` | This package (implementation record) |
| `docker-compose.yml` | pg15 + redis7 + api + web dev stack |
| `.github/workflows/ci.yml` | Lint + typecheck + unit tests on pg/redis services |
| `.env.example` | Documented env template; `apps/api/.env` is the live local file |
| `.nvmrc` (`20`), `pnpm-workspace.yaml` (`apps/*`), `turbo.json`, `package.json` | Toolchain pinning |
| `scripts/`, `pricing/`, `issues/`, `BUGS-SS/`, `.backups/` | Ancillary artefacts (not part of runtime) |
| `*.docx/*.pdf/*.html` (ESIC manuals, audit pages) | Client-facing reference material |

## Backend (`apps/api/`)

```
src/
  main.ts                 prefix/api, pipes, CORS, Vercel serverless + local listen
  app.module.ts           21 modules + guards + interceptor + middleware wiring
  health/                 health.controller.ts (GET /api/health @Public), module, spec
  common/
    decorators/           public, current-user (AuthenticatedUser), roles, permissions (RequirePermission)
    guards/               rbac.guard.ts, rbac.guard.spec.ts, rbac-matrix.spec.ts
    filters/              all-exceptions.filter.ts (global)
    interceptors/         audit.interceptor.ts (global AuditLog writer)
    middleware/           security.middleware.ts (+spec): headers + CSRF fallback
    prisma/               prisma.module.ts, prisma.service.ts
    sequence/             document-sequence.service.ts (+spec), sequence.definitions.ts, sequence.module.ts
    rendering/            document-render.service.ts, pdf-templates.ts, rendering.module.ts
  modules/<domain>/       controller(s) + service(s) + module + dto/ [+spec]
    admission/  analytics/  auth/  benefit/  billing/  catalog/  dashboard/
    employee/   facility/   inventory/  laboratory/  opd/  patient/
    pharmacy/   prescription/  procurement/  rbac-admin/  reports/
    therapy/    user/  visit/
prisma/
  schema.prisma           57 models, 33 enums (1495 lines)
  migrations/             10 content migrations + init
  seed.ts                 roles/permissions/users/wards/rules/catalog (1199 lines)
  seeds/                  catalog, lab-catalog, backfill/repair scripts
  demo-seed.ts, cleanup.ts, delete-*.ts, find-fake-emps.ts  one-off utilities
test/                     15 e2e specs + jest-e2e.json
Dockerfile / vercel.json / index.js / nest-cli.json / tsconfig*.json / .eslintrc.js
```

## Frontend (`apps/web/src/`)

| Path | What belongs there |
|---|---|
| `App.tsx`, `main.tsx` | Router + auth gate |
| `components/layout/` | `AppShell` (PageId router), `Sidebar` (24 PageIds + role filter), `TopNav`, `Breadcrumb` |
| `components/ui/` | `DataTable` (filter/sort/paginate/CSV), `StatCard`, `Badge` |
| `components/uid-card/` | `UidCard` (QR + `#printable-uid-card` print CSS) |
| `api/` | 24 per-domain modules; `client.ts` (token + 401 purge), `http.ts` (ApiError + unwrap) |
| `hooks/useAuth.ts` | Sole global store (auth + theme via TopNav localStorage) |
| `lib/permissions.ts` | `can(role, capability)` mirror (lab/therapy capabilities) |
| `pages/` + `pages/doctor|pharmacy|reception/` | Workspaces (EnterpriseReceptionDesk, DoctorWorkspace, PharmacyWorkspace…) |
| `screens/<domain>/` | One screen per operational area (opd, admission, laboratory, therapy, inventory, procurement, billing, analytics, reports, admin) |
| `__tests__/` | routing + permissions + App tests |
| `index.css` | Design tokens + `@media print` rules (slips, cards, Rx, receipts) |
