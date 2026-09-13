# 01 — Project Overview (VERIFIED)

## What this project is

ESIC HMS is a hospital management system for Labour Department employees and their care pathways.
A Labour-Department `Employee ID` is verified, mapped to one permanent immutable `Hospital UID` with a QR card,
and every later event (OPD visit, consultation, prescription, lab order, therapy session, admission, charge,
receipt, stock transaction) hangs off that identity.

- **Monorepo root:** `ESIC/` — `package.json` (`esic-hms@0.1.0`, `pnpm@9.15.4`, `turbo@2.3.3`, Node `>=20`).
- **Backend:** `apps/api` — `@esic-hms/api@1.0.0`, NestJS 10.4.15, Prisma 5.22.0, PostgreSQL, Redis/ioredis 5.4.2.
- **Frontend:** `apps/web` — `@esic-hms/web`, React 18.3.1, Vite 5.4.11, Tailwind 3.4.17, react-router-dom 6.28.1.
- **Docs intent (reference only):** `docs/00-overview.md`, `05-prd.md`, `06-requirements.md`, `07-functional-spec.md`.

## Who uses it (VERIFIED — 13 seeded roles)

Source: `apps/api/prisma/seed.ts:8-22` (`SYSTEM_ROLES`).

| Role | Purpose in implementation |
|---|---|
| Reception | Registration, OPD queue, ledger/receipts read, therapy create (direct-therapy entry) |
| Doctor | Diagnosis, prescriptions + sign, admission recommend/approve, lab/therapy ordering |
| AdmissionDesk | Admissions CRUD + transfer, receipts |
| Nurse | Ward notes, therapy perform (`TherapySession:update`), admission transfer |
| Pharmacist | Dispense queue, FEFO dispense, inventory reads |
| StoreManager | Inventory, requisitions, batches |
| ProcurementOfficer | Approvals, purchase orders |
| DataEntryOperator | `Employee` create/read/update only (demographic corrections) |
| Administrator | ~70 explicit grants; service/pricing/catalog, charges, analytics, reports, RBAC config, branding |
| SuperAdmin | `*:*` — only role that bypasses `RbacGuard` |
| QueueManager | OPD queue display only (`Visit`/`OPDVisit:read`) |
| LabTechnician | Sample collect + result entry (no verify) |
| Pathologist | Result verify + report release |

## Module map (VERIFIED — `src/app.module.ts:36-63`, 21 modules)

`auth, employee, patient, facility, benefit, prescription, visit, opd, admission,
pharmacy, inventory, procurement, billing, catalog, laboratory, therapy,
analytics, reports, dashboard, user, rbac-admin` + `health` + `common` (prisma, sequence, rendering, guards).

## What is explicitly out of scope in v1 (per `docs/05-prd.md`, NOT VERIFIED in code)

Patient self-portal, insurance beyond Labour Dept, telemedicine, payment gateway
(ledger + receipt only — VERIFIED: `PaymentMode` enum is `CASH,UPI,CARD,NOT_APPLICABLE`, no gateway client exists),
lab device feed (manual result entry — VERIFIED), multi-hospital, native mobile.

## Key numbers (VERIFIED)

- Prisma models: **57**, enums: **33** (`apps/api/prisma/schema.prisma`, 1495 lines).
- Migrations: **10** content migrations + init (`apps/api/prisma/migrations/`).
- Backend spec files: **30**; e2e files: **15** (`apps/api/test/`).
- Frontend routes: **24** `PageId`s (`apps/web/src/components/layout/Sidebar.tsx`).
