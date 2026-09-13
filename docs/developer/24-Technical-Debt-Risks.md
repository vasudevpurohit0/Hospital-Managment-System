# 24 — Technical Debt & Risks (DOCUMENTED ONLY)

## Duplication / inconsistency

- **D1 — Two `patients` controllers** (`patient.controller.ts` + `visit/patient-lookup.controller.ts`) share
  prefix `patients` — split by history, confusing to trace; consider documented ownership, not refactor (out of scope).
- **D2 — Two `admissions` controllers** (admission + ipd-finance) share prefix — same note.
- **D3 — Legacy `BillingTransaction` + `billing.controller` coexist with `ChargeItem` ledger.**
  Old reads still served; new code must use charges/receipts. Migration/backfill scripts in `prisma/seeds/`
  (`backfill-billing-transactions`, `repair-discounted-charges`) confirm the transition is historical, not clean.
- **D4 — Naming drift:** `Billing:read` vs `Charge:read` vs `Receipt:*`; `OPDVisit` vs `Visit`; docs say
  9/10 roles in places vs 13 seeded. `docs/00–08` predate lab/therapy/IPD-location/sequence migrations.

## Dead / unused / unverified

- **X1 — `PatientWorkspace.tsx`** not in `renderPage` (dead screen).
- **X2 — `ManualVerificationCase`** model without a traced controller (degrade path partial).
- **X3 — `POST /users`-style generic user creation** — verify existence before building on it (only `GET /users` + doctors create traced).
- **X4 — `SystemConfigScreen`, `DoctorSchedulePage` create, `TopNav` notifications** — backing endpoints NOT VERIFIED.
- **X5 — `scripts/`, `pricing/`, `demo-seed.ts`, `cleanup.ts`, `delete-*.ts`** — one-off utilities; do not run against shared DBs without review.

## Missing validations / tests

- No idempotency keys on charge/receipt POSTs (double-submit risk; mitigated partially by link constraints).
- Excel import caps/scans NOT VERIFIED (§23 H4). File/photo upload limits NOT VERIFIED.
- E2E excluded from CI; frontend e2e absent; Playwright/VAPT claims NOT VERIFIED.
- Ownership/IDOR checks per endpoint NOT systematically traced — assume absent.

## Scalability / architecture

- `AuditInterceptor` writes `AuditLog` inline per mutation (latency + failure-coupling; failures are swallowed
  with log-only — good for availability, bad for completeness; monitor `Failed to write AuditLog`).
- Token-permission reload per request is correct but DB-hot; fine at 1-hospital scale, revisit with caching + versioning if scaled.
- Dev Dockerfiles run `start:dev`/vite (no prod image, no multi-stage, no read-only FS, no secret management).
- Frontend has no server-state cache; heavy screens refetch on mount — acceptable now, watch with data growth.

## Rule for contributors

Add to this file; do not "fix" debt inside documentation commits. Behavioural changes need their own
reviewed change with migration + e2e coverage.
