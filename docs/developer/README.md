# ESIC Hospital Management System — Developer Documentation

> **Status:** VERIFIED against implementation as of September 2026.
> **Source of truth:** `apps/api/src`, `apps/api/prisma/schema.prisma`, `apps/web/src`.
> Client-facing briefs in `docs/00–08` describe *intent*; this package describes *what is actually implemented*.
> Where intent and implementation differ, the difference is marked explicitly.

## Reading order

| # | Document | Answers |
|---|---|---|
| 01 | [Project-Overview](01-Project-Overview.md) | What is this system, who uses it? |
| 02 | [System-Architecture](02-System-Architecture.md) | How is it structured at runtime? |
| 03 | [Repository-Structure](03-Repository-Structure.md) | Where does everything live? |
| 04 | [Database-Architecture](04-Database-Architecture.md) | What are the 57 models and how do they relate? |
| 05 | [RBAC-Security](05-RBAC-Security.md) | REAL role × module × action matrix |
| 06 | [Authentication](06-Authentication.md) | Login, JWT, refresh, guards, seeding |
| 07 | [Patient-Management](07-Patient-Management.md) | Employee → UID → profile → visits |
| 08 | [OPD-Consultation](08-OPD-Consultation.md) | Tokens, queue, diagnosis, prescriptions |
| 09 | [Laboratory](09-Laboratory.md) | Orders → samples → results → verify → report |
| 10 | [Pharmacy](10-Pharmacy.md) | Signed queue → FEFO dispense |
| 11 | [Therapy](11-Therapy.md) | Courses, sessions, three entry points |
| 12 | [IPD-Ward](12-IPD-Ward.md) | Admissions, beds, transfers, discharge |
| 13 | [Billing-Ledger-Payments](13-Billing-Ledger-Payments.md) | ChargeItem ledger, receipts, outstanding |
| 14 | [Pricing-Facility-Rules](14-Pricing-Facility-Rules.md) | Service catalogue, versioned pricing, eligibility rules |
| 15 | [Inventory-Procurement](15-Inventory-Procurement.md) | Batches, FEFO, expiry, requisition → PO → GRN |
| 16 | [Analytics-Reports](16-Analytics-Reports.md) | Dashboards, CSV reports, PDF rendering |
| 17 | [API-Reference](17-API-Reference.md) | Every controller, method, path, permission |
| 18 | [Frontend-Architecture](18-Frontend-Architecture.md) | PageId router, role navigation, API layer |
| 19 | [Integrations](19-Integrations.md) | Verified dependency map |
| 20 | [Deployment](20-Deployment.md) | Local / Docker / production reality |
| 21 | [Testing](21-Testing.md) | Unit, e2e, RBAC matrix, CI |
| 22 | [Business-Rules](22-Business-Rules.md) | Each rule + enforcement location |
| 23 | [Security-Audit](23-Security-Audit.md) | Findings, classified, no fixes applied |
| 24 | [Technical-Debt-Risks](24-Technical-Debt-Risks.md) | Debt, dead code, gaps — documented only |
| 25 | [New-Developer-Onboarding](25-New-Developer-Onboarding.md) | Start here on day one |
| 26 | [End-to-End-System-Map](26-End-to-End-System-Map.md) | Master flow map |
| — | [Final Audit Report](00-Audit-Report.md) | Completeness %, gaps, readiness verdict |

## Conventions used in every file

- **VERIFIED** — traced to a file/line in code or schema.
- **NOT VERIFIED** — mentioned in `docs/00–08` or comments but not traced to executing code.
- **IMPLEMENTED BUT NO UI** — backend endpoint exists, no frontend screen calls it.
- **UI EXISTS BUT BACKEND GAP** — frontend calls an endpoint that is missing, stubbed, or broken.
- **KNOWN ISSUE / TECHNICAL DEBT** — documented, never fixed by this task.

## One-page truth

- Monorepo (`pnpm@9.15.4` + `turbo@2.3.3`): `apps/api` (NestJS 10 + Prisma 5.22 + PostgreSQL 15 + Redis 7) and `apps/web` (React 18 + Vite 5 + Tailwind 3 + react-router-dom 6, custom PageId router).
- Global API prefix `api` (`apps/api/src/main.ts:15,45`): every route is `/api/<controller-prefix>`.
- Auth: JWT Bearer access (8h) + refresh (7d), global `JwtAuthGuard` + global `RbacGuard`; only `SuperAdmin` bypasses permission checks (`src/common/guards/rbac.guard.ts:40`).
- 13 seeded roles, permission rows in `Permission` table seeded from `PERMISSION_GRANTS` (`apps/api/prisma/seed.ts:36-285`).
- Money: single writer `ChargeService` (`src/modules/billing/charge.service.ts`); every charge cites `servicePriceId`; `discountAmount` always 0; pharmacy rate comes from the dispensed batch, not the catalogue.
- Stock: FEFO = `orderBy expiryDate asc` excluding `EXPIRED/QUARANTINED/DISPOSED` (`src/modules/pharmacy/pharmacy.service.ts:86-94`); only GRN path creates batches; expiry scanner quarantines past-expiry batches.
- Documents: `DocumentSequence` + `SEQUENCES` registry (`src/common/sequence/sequence.definitions.ts`): OPD/IPD/LAB/RCPT numbers + daily per-department queue tokens.
- Audit: global `AuditInterceptor` writes `AuditLog` on every mutating request except `auth`/`health` (`src/common/interceptors/audit.interceptor.ts`).
- Tests: 30 unit spec files + 15 e2e files; RBAC matrix spec imports `PERMISSION_GRANTS` so seed and guard cannot drift silently. CI (`.github/workflows/ci.yml`) runs lint + typecheck + unit tests on postgres:15 + redis:7 services.
