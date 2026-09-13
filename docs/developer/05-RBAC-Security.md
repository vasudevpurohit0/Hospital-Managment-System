# 05 — RBAC & Security Implementation (VERIFIED)

Single source of truth: `PERMISSION_GRANTS` in `apps/api/prisma/seed.ts:36-285`.
Enforcement: global `RbacGuard` (`src/common/guards/rbac.guard.ts`).
Conformance test: `src/common/guards/rbac-matrix.spec.ts` imports `PERMISSION_GRANTS`
and asserts every handler carries `@Public/@RequirePermission/@Roles` (or allowlist) —
seed and guard cannot drift silently. E2E: `test/rbac.e2e-spec.ts`, `test/security.e2e-spec.ts`.

## How authorization works

1. `JwtAuthGuard` (global APP_GUARD 1) authenticates; `@Public()` skips it.
   Public endpoints (VERIFIED): `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/refresh`,
   `GET /api/branding` (+ `config/branding` alias).
2. `RbacGuard` (global APP_GUARD 2):
   - No `@Roles`/`@RequirePermission` → allow (line 23-25). NOTE: this default-allow is a risk — see §23.
   - Missing `user.roleName` → 403.
   - `SuperAdmin` → bypass (line 40). Administrator does NOT bypass (comment lines 34-39);
     it carries ~70 explicit rows.
   - `@Roles(...)` → role membership; `RequirePermission(resource, action)` → match
     `user.permissions` with `*` wildcards supported (lines 58-62).
3. `@Roles()` is effectively unused — every protected handler uses `RequirePermission`.
4. Frontend mirror: `Sidebar.tsx:61-236` hides nav per role; `lib/permissions.ts can()` mirrors
   lab/therapy capabilities; SuperAdmin bypasses both. Frontend hiding is NOT enforcement.

## ROLE × MODULE × ACTION matrix (from PERMISSION_GRANTS)

Legend: R=read C=create U=update D=delete (+ special actions). `*` = SuperAdmin `*:*`.

| Module / resource | Reception | Doctor | AdmisDesk | Nurse | Pharmacist | StoreMgr | ProcOff | DEO | Admin | QMgr | LabTech | Pathol |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Employee | R,C,U | R | R | R | R | — | — | R,C,U | full* | — | — | — |
| HospitalUID | R,C | — | — | — | — | — | — | — | full* | — | — | — |
| Visit | R,C | R | R | R | — | — | — | — | full* | R | — | — |
| OPDVisit | R,C | R | — | — | — | — | — | — | full* | R | — | — |
| Doctor (directory) | R | R | R | R | — | — | — | — | C,R* | — | — | — |
| Diagnosis | — | R,C | — | — | — | — | — | — | full* | — | — | — |
| Prescription | — | R,C,sign | — | — | R | — | — | — | full* | — | — | — |
| Admission | — | R,C,approve | R,C,U,transfer | R,transfer | — | — | — | — | full* | — | — | — |
| AdmissionNote | — | — | — | R,C | — | — | — | — | full* | — | — | — |
| LabTest | — | R | — | — | — | — | — | — | R,C,U* | — | R | R |
| LabOrder | — | R,C | — | — | — | — | — | — | R,C,U* | — | R | R |
| LabSample | — | — | — | — | — | — | — | — | full* | — | C | C |
| LabResult | — | — | — | — | — | — | — | — | full* | — | R,C,U | verify,R,C |
| LabReport | — | R | — | — | — | — | — | — | R,C* | — | — | R,C,release |
| TherapySession | R,C | R,C | — | R,U | — | — | — | — | full* | — | — | — |
| StockTransaction | — | — | — | — | dispense,R | — | — | — | full* | — | — | — |
| Medicine/MedicineBatch | — | — | — | — | R | R,C,U | — | — | R,C,U* | — | — | — |
| PurchaseRequisition | — | — | — | — | — | R,C | — | — | full* | — | — | — |
| Approval | — | — | — | — | — | — | approve | — | approve* | — | — | — |
| PurchaseOrder | — | — | — | — | — | — | R,C | — | R,C* | — | — | — |
| Charge | R | R | R | R | R | — | — | — | R,C,cancel* | — | — | — |
| Receipt | R,C | — | R,C | — | R | — | — | — | R,C* | — | — | — |
| Service/ServicePrice | — | R(svc) | — | — | — | — | — | — | R,C,U* | — | — | — |
| BenefitRule/FacilityRule | — | — | — | — | — | — | — | — | R,C,U* | — | — | — |
| Analytics | — | — | — | — | — | — | — | — | R* | — | — | — |
| Report:generate | — | — | — | — | — | — | — | — | generate* | — | — | — |
| RbacConfig | — | — | — | — | — | — | — | — | R,U* | — | — | — |
| Billing (legacy) | — | — | — | — | — | — | — | — | R* | — | — | — |
| BrandingConfig | — | — | — | — | — | — | — | — | update* | — | — | — |

`*Admin` ≈ full grants listed in seed lines 200-285 — verify exact rows before relying on this table.

## KNOWN frontend-vs-backend mismatches (VERIFIED)

- `ProcurementOfficer` sees only `dashboard` in Sidebar but holds `Approval:approve + PurchaseOrder` backend grants → backend capability with (almost) no UI.
- `LabTechnician/Pathologist` are NOT in Sidebar `dashboard` roles — they land via direct `/laboratory` URL; palette/landing logic assumes this.
- `DataEntryOperator` sees only `dashboard` but holds `Employee create/update` — usable only if some dashboard surface calls it, else IMPLEMENTED BUT NO UI.
- `users` list endpoint requires `Admission:update` (`user.controller.ts`) — any role with that grant (AdmissionDesk, Nurse-transfer? No: transfer≠update; effectively AdmissionDesk + Admin) can list users: surprising coupling, see §23.
