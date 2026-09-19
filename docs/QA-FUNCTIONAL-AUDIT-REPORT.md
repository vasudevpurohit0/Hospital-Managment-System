# Hospital Management System — Complete Module-Wise QA, Security & Code Audit

**Date:** 2026-09-19
**Method:** Static, read-only code review (backend `apps/api/src`, frontend `apps/web/src`, Prisma schemas, existing test suites, compiled `dist/` output for DTO-erasure verification). No live server was started, no database was touched, and no code was modified. Dynamic/live API testing with real role tokens and browser-driven UI testing were **not** performed in this pass — see the Testing Gaps section for what that would still need to verify.
**Companion document:** `docs/SECURITY-AUDIT-REPORT.md` (2026-09-19) covers the dedicated security pass in full detail (auth, tenant isolation, injection, secrets, infra). This report references those findings by ID (`V-xx`) rather than repeating them, and focuses on functionality, RBAC correctness, workflows, validation, and code/test quality.

---

## 1. Executive Summary

This system is better engineered than the average project of its size — the schema-per-tenant multi-tenant architecture is structurally sound, the backend test suite is unusually thorough where it exists (real business-rule and concurrency assertions, not smoke tests), and several modules (Therapy, Catalog/Pricing, OPD, Laboratory) show genuine defense-in-depth discipline. However, this audit — which went module-by-module through every controller/service/DTO and traced four complete cross-module workflows — found **real, concrete functional bugs that would affect real hospital operations**, not just theoretical security gaps:

- A **discharge can silently steal a currently-admitted patient's bed** if called twice (confirmed independently by two different reviewers tracing two different angles).
- A **prescription edit screen doesn't actually save** — it returns success but never writes to the database.
- A **purchase-requisition approval workflow can be self-approved** by the same role that raised it, and **goods-receipt has no check against the purchase order at all** (can receive more, less, or entirely different medicines than ordered).
- **Pharmacy has two separate inventory ledgers and only updates one of them** — the pharmacy-location stock number silently goes stale after every stock transfer.
- **Freshly onboarded hospital administrators can become permanently unable to log in** if their identifier has any uppercase letter.
- **No platform-level administrative action is audit-logged** (create/suspend/delete a hospital, admin CRUD) — only Super Admin's data *reads* are logged.
- The **frontend has no role-based route guard** — any logged-in user can navigate straight to `/rbac-management`, `/billing`, `/system-config` and the full admin page renders.
- `/dashboard/summary` has **no permission check at all**, leaking admin-tier billing/staff/audit figures to every role.

None of these are exotic attack chains — they are things that will happen in normal use (a double-submitted discharge, a receptionist editing the wrong field, an admin typing an email with a capital letter, a pharmacist opening the dashboard). They are prioritized accordingly in the fix order below.

| Severity | Count |
|---|---|
| Critical | 11 |
| High | 19 |
| Medium | 21 |
| Low | 16 |

(Counts are for **functional/QA findings** newly surfaced in this pass. The dedicated security audit's 1 Critical / 12 High / 9 Medium / 7 Low findings are tracked separately in `docs/SECURITY-AUDIT-REPORT.md` and summarized again in §11.)

---

## 2. Module Inventory

Discovered from actual controllers, frontend pages/screens, and Prisma models — not assumed.

| Module | Frontend | Backend | DB | Tests | Notes |
|---|---|---|---|---|---|
| Auth (login/activation/reset) | ✅ | ✅ | ✅ | ✅ | Functionally solid; security covered in companion report |
| Patient Registration | ✅ | ✅ | ✅ | ⚠️ | Largest backend file, heavy `any` usage |
| Visit / Registration | ✅ (via Reception desk) | ✅ | ✅ | ⚠️ | Duplicate/diverging `createVisit` implementations |
| OPD Queue | ✅ | ✅ | ✅ | ✅ | Strong state-machine tests |
| Admission / IPD | ✅ | ✅ | ✅ | ❌ (main service) | Critical discharge/bed bug |
| Prescription | ✅ | ✅ | ✅ | ⚠️ | Update-doesn't-persist bug slipped past tests |
| Laboratory | ✅ | ✅ | ✅ | ✅ | Best-validated DTOs in the system |
| Therapy | ✅ | ✅ | ✅ | ✅ | Strongest-engineered module overall |
| Billing / Charges / Receipts | ✅ | ✅ | ✅ | ✅ | Solid; one receipt double-issue race |
| Pharmacy | ✅ | ✅ | ✅ | ⚠️ | Stock race + dual-ledger bug |
| Inventory | ✅ | ✅ | ✅ | ⚠️ | No numeric validation on batch creation |
| Procurement | ✅ | ✅ | ✅ | ⚠️ | Self-approval + no GRN/PO cross-check |
| Catalog / Pricing | ✅ | ✅ | ✅ | ✅ | Cleanest module in the audit |
| Benefit Rules | ✅ | ✅ | ✅ | ⚠️ | Versioning inconsistent with rest of system |
| Facility Eligibility | ✅ | ✅ | ✅ | ✅ | Minor transaction gap |
| Employee Directory | ✅ | ✅ | ✅ | ❌ | Mass-assignment bug (V-07), unscoped update grant |
| Doctor Management | ✅ | ✅ | ✅ | ✅ | ~90% duplicated with Staff module |
| Staff Management | ✅ | ✅ | ✅ | ✅ | ~90% duplicated with Doctor module |
| User/Role listing | — | ✅ | ✅ | ❌ | Wrong permission gating it |
| RBAC Admin | ✅ | ✅ | ✅ | ❌ | No audit log on grant/revoke |
| Department Management | ✅ | ✅ | ✅ | ❌ | Solid otherwise |
| Platform / Hospital Onboarding | ✅ | ✅ | ✅ | ❌ | Zero test coverage; identifier case-mismatch bug |
| Platform Admin Management | ✅ | ✅ | ✅ | ❌ | Solid self-management guards |
| Platform Dashboard | ✅ | ✅ | ✅ | ❌ | Correctly PHI-safe aggregation |
| Platform Audit Log | ✅ | ✅ | ✅ | ❌ | Only logs data reads, not admin actions |
| Platform Staff Audit | ✅ | ✅ | ✅ | ❌ | Silent per-hospital failure drops |
| Reports (CSV) | ✅ | ✅ | ✅ | ❌ | Unbounded exports + formula injection |
| Analytics | ✅ | ✅ | ✅ | ✅ | Solid calculation correctness |
| Dashboard | ✅ | ✅ | ✅ | ⚠️ | Missing permission check; unbounded scan |
| Audit Log | ✅ | ✅ | ✅ | ✅ | Well-tested, good pagination discipline |

---

## 3. Critical Findings

| ID | Finding | File(s) |
|---|---|---|
| F-01 | `AdmissionService.discharge()` frees the bed unconditionally with no `status !== DISCHARGED` guard and no re-check that the bed still belongs to this admission — a duplicate/stale discharge call can silently evict a **different, currently-admitted patient's** bed, flipping their bed to AVAILABLE while their admission stays UNDER_TREATMENT. | `apps/api/src/modules/admission/admission.service.ts:492-501` |
| F-02 | `PrescriptionService.updatePrescription()` never persists edits — it does `Object.assign(existing, dto)` and returns the in-memory object without ever calling `prisma.prescription.update()`. Users editing a DRAFT prescription believe it saved; nothing is written to the database. | `apps/api/src/modules/prescription/prescription.service.ts:77-96` |
| F-03 | Procurement approval workflow can be self-approved: `StoreManager` holds both `PurchaseRequisition:create` and `Approval:approve`, and `approveRequisition()` never checks `requisition.raisedBy !== callerId`. | `apps/api/src/modules/procurement/procurement.service.ts:114` (permission grants: `prisma/seed.ts:175-178`) |
| F-04 | `createGRN()` performs zero cross-validation against the purchase order — no check on PO status, no check that received quantity/medicine matches ordered quantity/medicine, and it can be called repeatedly against the same PO. `RequisitionStatus` is set to `FULFILLED` on **any** GRN regardless of completeness. | `apps/api/src/modules/procurement/procurement.service.ts:212-286` |
| F-05 | Pharmacy `dispense()` has a non-atomic read-modify-write race on `MedicineBatch.currentStock` — confirmed by two independent reviewers; can cause lost updates/overselling under concurrent requests. (= security report V-08 / injection-agent Finding, cross-referenced here as a functional correctness bug too.) | `apps/api/src/modules/pharmacy/pharmacy.service.ts:154-187` |
| F-06 | Two separate inventory ledgers exist (`MedicineBatch.currentStock` and `PharmacyStock`), and `dispense()` only decrements the first. After any Central→Pharmacy store transfer, the pharmacy-location `PharmacyStock` figure becomes permanently stale/overstated, even though it's the number exposed by `getPharmacyStock()` to hospital staff. | `apps/api/src/modules/pharmacy/pharmacy.service.ts:181-198`, `apps/api/src/modules/inventory/inventory.service.ts:132-167`, `apps/api/src/modules/procurement/procurement.service.ts:260-267,304-328` |
| F-07 | `PUT /employees/:id` mass-assignment via `Partial<CreateEmployeeDto>` TypeScript erasure — silently bypasses the global `ValidationPipe`'s whitelist protection, letting any role with `Employee:update` (including Reception/DataEntryOperator) write arbitrary extra fields, including `postId`/`gradeId`/`employmentTypeId` for **any** employee, not just demographic fields as the permission's own documentation intends. (= security report V-07, extended here with the front-desk-role angle.) | `apps/api/src/modules/employee/employee.controller.ts:74`, `employee.service.ts:124-136` |
| F-08 | Hardcoded fallback JWT secrets — see security report V-01. Cross-referenced here because the RBAC-admin agent independently confirmed this is the mechanism that would make platform-level RBAC bypass possible if ever triggered by a missing env var. | `apps/api/src/modules/auth/auth.service.ts` + 3 other files (see V-01) |
| F-09 | Hospital-admin identifier case-mismatch: `TenantUserProvisioningService.provisionAdministrator()` never lowercases the identifier before writing the tenant `User` row, while `LoginDirectoryService.register()` always lowercases before storing and `AuthService.validateUser()` queries by raw case. **Any onboarded hospital admin (or cross-hospital admin, or password-reset target) whose identifier contains an uppercase character can never log in.** Nothing in the DTO or UI validates/normalizes this. | `apps/api/src/common/tenant/tenant-user-provisioning.service.ts:23-43`, `apps/api/src/modules/platform/hospitals.service.ts:212-222`, `hospital-admins.service.ts:75-91` |
| F-10 | No platform-level mutating action (create/suspend/reactivate/delete hospital, hospital-admin CRUD, platform-admin CRUD) writes to `PlatformAuditLog`. Only the Super Admin's cross-hospital **data-read** access is logged (in `tenant-resolution.middleware.ts`). `/platform/audit-log` cannot answer "who suspended hospital X" or "who created this platform admin." | Entire `apps/api/src/modules/platform/*.service.ts` tree |
| F-11 | RBAC Admin `grantPermission()`/`revokePermission()` write no audit-log entry at all — the single most security-sensitive action in the whole system (who can do what) is the one action nowhere else in the codebase's otherwise-consistent audit-logging discipline covers. There is also no self-escalation guard beyond blocking the literal `*:*` wildcard string. | `apps/api/src/modules/rbac-admin/rbac-admin.service.ts:57-92` |

---

## 4. High Priority Findings

| ID | Finding | File(s) |
|---|---|---|
| F-12 | No role-based route guard at the frontend render layer — `AppShell.tsx`'s `renderPage()` switches purely on URL-derived page id with zero role check. Any authenticated user can navigate directly to `/rbac-management`, `/billing`, `/system-config`, `/staff-management`, `/analytics`, `/reports`, etc. and the full admin screen renders client-side (page shell, forms, and fetch-attempt error messages are all exposed; backend RBAC still blocks the actual data mutation). Inconsistent with `DoctorSchedulePage.tsx`/`OpdQueueScreen.tsx`, which do self-gate, proving the pattern is known but unevenly applied. | `apps/web/src/components/layout/AppShell.tsx` (`renderPage()`) |
| F-13 | `GET /dashboard/summary` has no `@RequirePermission` — any authenticated role (Pharmacist, Reception, LabTechnician, etc.) can pull admin-tier billing totals, staff counts, and recent audit-log exceptions that are correctly Administrator-only everywhere else in the system. | `apps/api/src/modules/dashboard/dashboard.controller.ts:19` |
| F-14 | Unbounded CSV report exports (billing/outstanding/patient-register) + Excel/CSV formula injection in the shared `toCsv()` helper — also confirmed to affect the audit-log CSV export path, which was thought to be better-hardened (it caps rows at 5000 but shares the same unescaped `toCsv()`). (= security report V-05, extended.) | `apps/api/src/modules/reports/reports.service.ts`, `csv.util.ts`, `apps/api/src/modules/audit/audit-log.service.ts` |
| F-15 | `VisitService.createVisit()` (the standalone `/visits` endpoint, distinct from the patient-module registration path) does not validate that the resolved employee exists before creating the Visit — an unresolved employee id falls through to a raw DB foreign-key violation instead of a clean 404. The patient-module's own `createVisit()` does this check correctly; the two implementations have diverged. | `apps/api/src/modules/visit/visit.service.ts:28-37` |
| F-16 | `AdmissionService.discharge()`/`allocateBed()` don't check the admission's current status before acting — permits double-discharge and "un-discharging" an admission by re-allocating a bed to it. | `apps/api/src/modules/admission/admission.service.ts:353-525` |
| F-17 | Several OPD endpoints (`createOpdVisit`, `callToken`, `getMyPatients`, `closeOpdVisit`) are gated by `Employee:read` instead of an OPD/Visit-specific create/update permission — a read-only role could perform OPD create/close actions through these routes. | `apps/api/src/modules/opd/controllers/opd.controller.ts:12-16,46-50,92-102` |
| F-18 | `prescription.controller.ts` defaults an unauthenticated/unknown role to `'Doctor'` before calling a role-gated service method (`req.user?.roleName || req.user?.role || 'Doctor'`), potentially defeating the paired service-layer role check. | `apps/api/src/modules/prescription/prescription.controller.ts:29` |
| F-19 | `CreateBatchDto` (inventory) numeric fields (`purchasePrice`, `issuePrice`, `currentStock`, `minimumStockLevel`, `reorderLevel`, `maximumStockLevel`) are bare `@IsNumber()` with **no** `@Min(0)`/`@IsPositive()`, and `createBatch()` has zero server-side sanity check — a caller can create a batch with negative stock or negative price, and nothing downstream catches it (unlike pharmacy's negative-quantity case, which is incidentally caught by a different module). | `apps/api/src/modules/inventory/dto/create-batch.dto.ts`, `inventory.service.ts` |
| F-20 | All procurement DTOs (requisition/PO/GRN/transfer) have unvalidated numeric fields with **no compensating check anywhere in the call chain** — worse than the inventory case above, since even the "masked by a downstream module" safety net doesn't exist here. | `apps/api/src/modules/procurement/dto/*.dto.ts` |
| F-21 | No status guard before re-approving/re-rejecting a requisition (repeated approvals create multiple `Approval` rows and can flip status back and forth); no cross-validation between PO items and requisition items; no cap on how many POs can be issued against one requisition. | `apps/api/src/modules/procurement/procurement.service.ts` |
| F-22 | `createStoreTransfer()` has the identical non-atomic read-then-write stock race as the pharmacy dispense bug (F-05), on `PharmacyStock.quantity`. | `apps/api/src/modules/procurement/procurement.service.ts:289-341` |
| F-23 | `ReceiptService.issue()` has no row-level lock/unique constraint preventing two concurrent receipt-issue calls over the same `chargeIds` from both succeeding — a possible double receipt for the same money under concurrency. Not covered by any existing test (only sequential-numbering-under-concurrency is tested). | `apps/api/src/modules/billing/receipt.service.ts` |
| F-24 | Plaintext temporary password returned in the HTTP response body at **four** call sites, not just the one previously reported: `doctor.service.ts` (`createDoctor`, `resetPassword`) and `staff.service.ts` (`createStaff`, `resetPassword`) — all captured verbatim into the audit log by the systemic `AuditInterceptor` issue (security report V-09/V-15). | `apps/api/src/modules/user/doctor.service.ts:250,343,491`, `staff.service.ts:356,492` |
| F-25 | `doctor.service.ts` and `staff.service.ts` are ~90% structurally identical (create/reset/lock/deactivate/resend-activation all mirror each other line-for-line) — a real fix-drift risk that has already manifested (the temp-password-in-response issue was fixed conceptually in neither, existing identically in both). | `apps/api/src/modules/user/doctor.service.ts`, `staff.service.ts` |
| F-26 | Dead frontend feature: `PatientRecordsPage.tsx`'s "Edit Profile" button is gated on `userRole === 'receptionist' || userRole === 'admin'`, but `userRole` is the real role name lowercased (`'reception'`, `'administrator'`) — the comparison strings don't match any real role, so **no role, including SuperAdmin, can ever see this button**, even though the underlying save handler is fully implemented. | `apps/web/src/pages/PatientRecordsPage.tsx:441` |
| F-27 | `LabOrder.admissionId` is written from the DTO with no check that the admission belongs to the same visit — a lab order (and its IPD-charge attribution) could be linked to a different patient's admission. | `apps/api/src/modules/laboratory/lab.service.ts:104-113` |
| F-28 | `AdmissionStatus.AWAITING_BED` and `DISCHARGE_APPROVED` are dead enum values, never set by any traced service code — `allocateBed()` jumps straight from `REQUESTED`/`ELIGIBILITY_CHECKED` to `UNDER_TREATMENT`, and `discharge()`'s own code comment calls it a "Doctor-approved discharge flow" despite there being no approval gate before `DISCHARGED`. | `apps/api/prisma/schema.prisma` (AdmissionStatus enum), `admission.service.ts` |
| F-29 | Nightly bed-day billing cron only charges admissions still `UNDER_TREATMENT` at midnight — the calendar day a patient is actually discharged on (other than the admission day itself) is never bed-day-billed. A quiet, recurring undercharge, not documented as intentional proration. | `apps/api/src/modules/admission/ipd-finance.service.ts` |
| F-30 | A hospital stuck in `PROVISIONING` after a failed onboarding retry has **no API-reachable recovery path** — `setStatus()` refuses to touch a PROVISIONING hospital and `remove()` requires SUSPENDED status first. The platform dashboard flags "stuck provisioning" hospitals but gives the operator no button to fix it. | `apps/api/src/modules/platform/hospitals.service.ts:197-245` |
| F-31 | Reception/DataEntryOperator's `Employee:update` grant is unscoped to the demographic-only fields the permission's own code comment says it should cover — combined with F-07, front-desk roles can silently reassign any employee's post/grade. | `apps/api/prisma/seed.ts:67-74` |

---

## 5. Functional Issues

Functionality confirmed **broken**, **incomplete**, **incorrect**, or **inconsistent** by direct code tracing.

### Broken
- **F-02** — Prescription edits don't save (see §3).
- **F-01/F-16** — Discharge/bed-allocation state machine can be driven into an inconsistent state (see §3).
- **F-26** — "Edit Profile" button on Patient Records is permanently unreachable due to a role-string typo — a fully-implemented feature that no user can ever trigger.
- **LoginPage.tsx** — "Forgot Password?" button has no `onClick` handler at all; footer "Privacy Policy"/"Terms of Use"/Helpdesk links are `href="#"` placeholders.
- **RBAC Admin** self-management: no audit trail of grants/revokes (F-11).

### Incomplete
- **No LabOrder cancellation path** exists despite the `CANCELLED` enum value and a code comment implying pre-collection cancellation is a supported workflow — no service method anywhere sets it.
- **Inventory quarantine reason is accepted from the client but never persisted** — the service parameter is literally named `_reason` and discarded; the API implies an audit trail that doesn't exist. (`inventory.controller.ts:135-139`, `inventory.service.ts:191-196`)
- **`FacilityEligibilityService.update()`** isn't wrapped in a transaction — if the second of its two writes fails, there's a window where zero active rules exist for that grade/post, and `resolve()` will 404 for every affected employee until manually fixed.
- **Frontend UI/UX gaps** (see also §12): `EnterpriseReceptionDesk.tsx` (2226 lines, the largest component in the app) has **no loading indicator anywhere**, despite driving patient search, registration, and OPD queue calls; most of its async paths fail silently to the console. `PharmacyWorkspace.tsx`'s queue can flash "No pending prescriptions" before its fetch resolves (no loading flag). `InventoryScreen.tsx`'s create-medicine/create-batch forms have no busy/disabled state, risking duplicate records on rapid double-click.

### Incorrect
- **F-04** — GRN accepted with no relationship to what was actually ordered.
- **F-03** — Approval workflow that can approve itself.
- **F-06** — Two inventory numbers that silently disagree after a transfer.
- **F-29** — Discharge-day bed charges silently never billed.
- **Dashboard "today" boundary** — `employeesAddedToday`/`getMySummary` compute "today" via server-local midnight (`new Date(new Date().toDateString())`), not hospital-local time; duplicated independently in two places, so a fix to one doesn't fix the other.
- **Reports/Analytics date-range boundary** — `to` is parsed as UTC midnight with an `lte` cutoff, so `to=2026-09-19` silently excludes records from later that same day; no validation rejects a reversed (`from > to`) or malformed range.

### Inconsistent
- **F-15** — Two independent `createVisit` implementations (patient module vs. visit module) with diverging validation; a bug already exists in the less-defended one.
- **F-25** — Doctor and Staff account-lifecycle services duplicated near-verbatim, already showing fix-drift.
- **Excel export** — two completely independent implementations (a hand-written SpreadsheetML/XML builder in Billing, and a **hand-rolled ZIP/CRC32 OOXML writer from scratch** in Inventory) solving the same problem two different, harder-to-maintain ways.
- **Frontend date formatting** — no shared utility anywhere in `apps/web/src`; 45 separate inline `toLocaleDateString`/`toLocaleString` call sites across 14 files with inconsistent locale/style options.
- **Magic-number time windows** (24h/30-day/90-day) for expiry and stock alerts reimplemented independently in four different files (`analytics.service.ts`, `dashboard.service.ts`, `inventory.service.ts`, `expiry-scanner.service.ts`) with no shared constant.

---

## 6. Role & Permission Issues

A full endpoint-by-endpoint permission inventory (all ~194 routes across 37 controllers) was produced as part of this audit — see the raw inventory referenced in §13. The confirmed *problems* found in that inventory, in the `Role → Module → Action → Expected → Actual → Result` format:

| Role | Module | Action | Expected | Actual | Result |
|---|---|---|---|---|---|
| Reception / DataEntryOperator | Employee | Update any field via `Employee:update` | Demographic fields only (per code comment) | No field-level scoping enforced; combined with mass-assignment bug, arbitrary fields writable | ❌ FAIL (F-07, F-31) |
| Any role with `Admission:update` | User listing | `GET /users` | Should require a `User`/`Staff` read permission | Gated by unrelated `Admission:update` | ❌ FAIL (mismatched permission string) |
| Any authenticated hospital role | Dashboard | `GET /dashboard/summary` | Administrator-tier billing/staff/audit fields restricted | No permission decorator at all | ❌ FAIL (F-13) |
| StoreManager | Procurement | Approve own requisition | Should be blocked (segregation of duties) | No `raisedBy !== callerId` check | ❌ FAIL (F-03) |
| Reception / DataEntryOperator / QueueManager / Accountant / Pharmacist / LabTechnician / Pathologist | Patient | `GET /patients/:id/history`, `/master` (full clinical history) | Clinical roles only | Gated by broad `Employee:read`, which these roles hold for unrelated reasons | ❌ FAIL (security report V-06) |
| Any role holding `Employee:read` | Visit/OPD | Create/close OPD visits via several endpoints | Should require OPD/Visit-specific create/update permission | Gated by `Employee:read` (read-only-sounding permission covering write actions) | ⚠️ PARTIAL (F-17) |
| Administrator | RBAC Admin | Grant a permission to any role | Should require the granting role's own permissions be a superset, or at least be audit-logged | Neither check exists | ⚠️ PARTIAL (F-11) |
| PlatformUser (any) | Platform | Access any hospital via `x-hospital-id` | Correct by design — only one global Super Admin tier exists (`PlatformUser` has no `role` column) | Confirmed intentional, not a gap | ✅ PASS (by design) |
| Administrator | RBAC-matrix (static) | Every controller route must have an explicit auth decorator | Enforced | `rbac-matrix.spec.ts` genuinely enforces this in CI and has already caught a real bug (`GET/POST /doctors` once being accidentally `@Public()`) | ✅ PASS (strong structural control) |
| All roles per seed.ts | RBAC boundary tests | Nurse can't touch prescriptions, Pharmacist can dispense but not alter diagnosis, LabTechnician can't verify, Doctor can't manage Staff | Enforced | Confirmed correctly enforced and regression-tested (`rbac-role-boundaries.spec.ts`) | ✅ PASS |

Everything else sampled across the 194-endpoint inventory (all of Billing, Catalog, Therapy, Facility, Benefit, Laboratory, Analytics, Audit Log, and all Platform-only routes) uses a correctly-scoped `@RequirePermission` matching the resource being acted on, verified against the actual seed-data grants.

---

## 7. Multi-Hospital Isolation Results

The dedicated security audit already performed a deep static trace of the tenant-isolation mechanism itself (schema selection, connection routing, the `PrismaService` proxy) and found it structurally sound — see `docs/SECURITY-AUDIT-REPORT.md` for that detail. This pass adds functional-workflow-level checks:

| Test | Expected | Actual | Result |
|---|---|---|---|
| Schema-per-tenant connection routing for every service in Clinical/Commercial/People/Reporting clusters | All queries go through the tenant-scoped `PrismaService`/`getTenantContext()` | Confirmed consistent across all ~24 modules audited — no service found using a raw or platform-level client for tenant data | ✅ PASS |
| Nightly cron jobs (bed-day billing, low-stock scan) scoped to ACTIVE hospitals only | Should skip suspended/provisioning hospitals | Both `procurement.service.ts` and `admission/ipd-finance.service.ts` correctly filter `status: 'ACTIVE'` and iterate sequentially with per-hospital try/catch | ✅ PASS |
| Platform Dashboard aggregation excludes suspended/provisioning hospitals from per-hospital metrics | Should exclude | Confirmed — `getSummary()` filters to `activeHospitals` before computing metrics; suspended/provisioning only appear as bare counts, no PHI-level detail crosses the hospital boundary | ✅ PASS |
| Suspended hospital's already-issued staff JWTs | Should stop working immediately | **Do not** — `tenant-resolution.middleware.ts`'s hospital-token branch never re-checks hospital status, unlike the platform-token branch | ❌ FAIL (security report finding, confirmed independently by two more agents in this pass) |
| Hospital-admin onboarding produces a working login | Should always work | **Fails whenever the identifier has an uppercase character** (F-09) — a same-hospital, not cross-hospital, functional break, but it's a multi-hospital-onboarding-path bug | ❌ FAIL |
| Platform-level administrative actions (create/suspend/delete hospital) are auditable | Should be logged | **Not logged at all** — only Super Admin data-reads are (F-10) | ❌ FAIL |
| No endpoint in Clinical/Commercial/People clusters takes a raw `hospitalId` from request body/query/params and uses it to select a schema | Confirmed | No such pattern found in ~24 modules reviewed; the handful of `hospitalId` references found are all server-derived from `getTenantContext()`, used only for display/email text | ✅ PASS |
| Onboarding rollback on mid-process failure (first attempt) | Should clean up the partially-created schema | Confirmed — `createHospital()` drops the schema and deletes the platform row on failure | ✅ PASS |
| Onboarding rollback on a **retried** failure (`resumeProvisioning`) | Should also clean up, or at least be recoverable | No cleanup on a second failure, and the hospital becomes stuck in PROVISIONING with no API path to fix it (F-30) | ⚠️ PARTIAL |

---

## 8. Validation Issues

| Module | Field | Expected | Actual | Problem |
|---|---|---|---|---|
| Inventory | `CreateBatchDto.currentStock`/`purchasePrice`/`issuePrice`/stock-level fields | Non-negative, `currentStock` integer | Bare `@IsNumber()`, no `@Min(0)`/`@IsPositive()`/`@IsInt()` | Negative stock/price acceptable with zero downstream guard (F-19) |
| Procurement | All quantity/price fields across requisition/PO/GRN/transfer DTOs | Non-negative | Bare `@IsNumber()` everywhere | No compensating check anywhere in the chain (F-20) |
| Pharmacy | `DispenseItemPayloadDto.dispenseQuantity` | Positive integer | `@IsNumber()` only | Negative quantity would *increase* stock; only saved by an unrelated downstream module's quantity check causing a transaction rollback — fragile, not a real guarantee |
| Prescription | `CreatePrescriptionDto.items` | At least one item (`@ArrayMinSize(1)`, as `CreateLabOrderDto` correctly does) | No minimum-size constraint | A prescription can be created with zero medicine items |
| Employee | `PUT /employees/:id` body | Whitelisted, validated fields only | `Partial<CreateEmployeeDto>` erases to `Object`, validation pipe skipped entirely | Mass assignment (F-07) |
| Reports/Analytics | `from`/`to` date query params | Valid, non-reversed date range | Invalid strings silently become `Invalid Date` and pass through to Prisma; no `from > to` check | Confusing/incorrect report results with no error surfaced |
| Auth | Password-change/reset DTOs | Minimum complexity enforced server-side | Not independently confirmed in this pass (flagged, not verified) — recommend explicit follow-up | Unknown — needs confirmation |

---

## 9. Missing Required Fields

Cross-checked DTO (`class-validator`) requirements against the corresponding Prisma schema nullability for the modules sampled.

| Layer | Field | UI | API (DTO) | Backend service check | Database | Inconsistency |
|---|---|---|---|---|---|---|
| Patient registration | Clinical demographic fields (dob, gender, allergies, bloodGroup) | Marked optional | `@IsOptional()` | — | Nullable columns | None — consistent |
| Inventory quarantine | `reason` | Sent as a plain string, no required indicator | `@Body('reason')`, no DTO at all | Accepted but **never persisted** (`_reason` param name) | No column stores it | UI/API imply a recorded reason; nothing captures it — a required-in-spirit field that's actually a no-op everywhere |
| Employee update | Any field | Whatever the form sends | `Partial<CreateEmployeeDto>` (no real requiredness enforced, everything optional by erasure) | No allowlist | Column-level nullability varies per field | The DTO layer's "required" semantics are entirely bypassed — see F-07 |
| Hospital onboarding | `adminIdentifier` | Free-text input, no format hint enforced | `@IsString()/@IsNotEmpty()` only — no `@IsEmail`, no case-normalization | None | Directory table lowercases; tenant `User` table doesn't | The one field genuinely needing a `.toLowerCase()`/`@Transform` is the one place it's missing (F-09) |
| Prescription | `items` | Form likely requires at least one row (not independently verified) | No `@ArrayMinSize(1)` | None | No DB constraint | Possible to submit an empty prescription |

---

## 10. Workflow Issues

```
Patient Registration
       ↓
Visit / OPD Visit          ✅ (validated, atomic charge posting)
       ↓
Prescription (create)      ✅ (visit existence validated)
       ↓
Prescription (edit)        ❌ BROKEN — edits never persist to DB (F-02)
       ↓
Prescription (sign)        ✅ (idempotent, correct role gate)
       ↓
Lab Order                  ⚠️ admissionId not cross-checked against visit (F-27)
       ↓
Lab Result → Verify        ✅ (strict status gating, cannot re-enter after verify)
       ↓
Charge posting             ✅ (auto-posted at sample collection / dispense / OPD visit — single writer design)
       ↓
Receipt / Payment          ⚠️ possible double-issue under concurrency (F-23)
```

```
Admission
       ↓
Bed Allocation              ✅ atomic (bed + admission status flip together)
       ↓
Nightly Bed-Day Billing     ⚠️ discharge-day never billed (F-29)
       ↓
Discharge                   ❌ BROKEN — no status guard, can free another patient's bed (F-01, F-16)
       ↓
Discharge Summary           ⚠️ mandatory at discharge time, but only editable by re-calling the dangerous discharge() path again
```

```
Requisition
       ↓
Approval                    ❌ BROKEN — same role can raise and approve (self-approval) (F-03)
       ↓
Purchase Order               ⚠️ no cap on POs per requisition, no line-item cross-check (F-21)
       ↓
Goods Receipt Note (GRN)     ❌ BROKEN — no validation against PO at all; can over/under/wrong-receive (F-04)
       ↓
Inventory (MedicineBatch)    ✅ correctly incremented
       ↓
Store Transfer               ⚠️ same stock race as pharmacy dispense (F-22)
       ↓
Pharmacy Dispense            ❌ BROKEN — decrements MedicineBatch but never reconciles PharmacyStock (F-06); also has its own stock race (F-05)
```

```
Hospital Onboarding
       ↓
Schema Creation + Migration + Seed   ✅ (rollback works on first failure)
       ↓
Admin Account Provisioning           ❌ BROKEN if identifier has uppercase chars — admin can never log in (F-09)
       ↓
First Login                          ✅ (once identifier issue is avoided)
       ↓
Staff Bootstrapping                  ✅ (Administrator can immediately create Doctor/Nurse/Reception accounts)
       ↓
Any Onboarding-Retry Failure          ❌ Hospital stuck in PROVISIONING, no API recovery path (F-30)
```

---

## 11. Security Findings

Full detail, evidence, attack scenarios, and remediation for every security-classed finding are in the companion `docs/SECURITY-AUDIT-REPORT.md`. Summary of that report's findings (IDs `V-xx`), plus new security-relevant items surfaced during this functional pass:

| ID | Severity | Module | Description |
|---|---|---|---|
| V-01 | Critical | Auth | Hardcoded fallback JWT secrets, no startup validation |
| V-02–V-12 | High | Auth/RBAC/Infra | Refresh-token non-rotation, wide-open CORS, no rate limiting, unbounded exports, overbroad clinical-data permission, mass assignment, pharmacy stock race, plaintext temp passwords in audit log, root containers, unguarded destructive scripts, tokens in localStorage |
| V-13–V-21 | Medium | Various | Suspended-hospital session persistence, non-functional CSRF middleware, systemic unredacted audit snapshots, branding CSS/script injection into shared PDF renderer, predictable seed passwords, no charge-creation idempotency, exposed dev DB/Redis ports, latent mass-assignment pattern elsewhere, no cross-tenant isolation e2e test |
| V-22–V-28 | Low | Various | Dev credential hygiene, missing security headers, unvalidated patient photo field, minor DTO gaps, mis-scoped permission naming, no body-size limit, connection-leak race |
| **NEW-01** | High | Platform | No audit logging for any platform-level administrative mutation (F-10) — a genuine accountability gap for the control plane, not previously covered because the security audit focused on data-access paths rather than administrative-action logging. |
| **NEW-02** | High | RBAC Admin | No audit logging on permission grant/revoke, and no self-escalation/delegation guard beyond the literal wildcard block (F-11). |
| **NEW-03** | High | Frontend | No role-based route guard in the page-render layer — sensitive admin screens are reachable by direct URL navigation for any authenticated role (F-12). Backend RBAC still blocks actual mutations, but page shells, forms, and error responses revealing endpoint shapes are exposed. |
| **NEW-04** | High | Dashboard | `GET /dashboard/summary` has no permission check, leaking admin-tier billing/staff/audit figures to every role (F-13). |
| **NEW-05** | Medium | Reports | Formula-injection risk confirmed to also affect the audit-log CSV export, not just the reports module (F-14). |

---

## 12. Code Quality Findings

### Critical (correctness/maintainability risk, not style)
- **F-25** — `doctor.service.ts`/`staff.service.ts` ~90% duplicated; a fix applied to one is not reliably applied to the other (already demonstrated by the temp-password-in-response issue existing identically in both).
- **`patient.service.ts`** is simultaneously the largest backend file (1,285 lines) and the single worst offender for `: any`/`as any` usage (36 occurrences) — untyped `whereClause: any` search-query construction is a real correctness risk (typos in Prisma field names would fail silently or match nothing, with no compile-time protection).

### Important
- **Excel export duplicated with two independent, non-trivial implementations** — a hand-written SpreadsheetML/XML builder (Billing, 453 lines) and a **from-scratch hand-rolled ZIP/CRC32/OOXML writer** (Inventory, 560 lines). The latter is a meaningfully riskier piece of code to maintain than adopting an existing library.
- **97 total `: any`/`as any` occurrences** (67 backend, 30 frontend) — concentrated in `patient.service.ts` (36), `apps/web/src/types/modules.d.ts` (12, ambient chart-library shims), `LabWorkbenchScreen.tsx` (6), and `procurement.controller.ts` (5, all harmless `@Req() req: any`).
- **No shared frontend date-formatting utility** — 45 inline `toLocaleDateString`/`toLocaleString` call sites across 14 files with inconsistent locale/style options.
- **Duplicated magic-number time windows** (30/90-day expiry thresholds) reimplemented independently in 4 files with no shared constant — any future change to the business rule requires editing all 4 in sync with no compiler assistance if one is missed.
- **9 `@Body()` parameters TypeScript-erase to `Object`** (confirmed via compiled `dist/` metadata, not guessed from source) — see the full list of 9 in the endpoint inventory; only 2 of the 9 (Employee update, Prescription update) currently have a live exploitable/functional consequence (F-07, F-02); the other 7 are currently harmless due to manual service-layer field allowlisting, but carry the same latent risk.
- **Role-name string literals inline in business logic** in a small, bounded set of files (`admission.service.ts`, `opd.service.ts`, `patient.service.ts`, `rbac-admin.service.ts`) instead of a shared enum/constant — including two dead checks for a `'SuperAdmin'` DB role that no longer exists (that concept is now the separate `PlatformUser` tier).

### Minor
- Very large frontend files needing decomposition: `EnterpriseReceptionDesk.tsx` (2,226 lines), `WardStaffScreen.tsx` (2,073), `DoctorWorkspace.tsx` (1,410), `InventoryScreen.tsx` (1,077), `ProcurementScreen.tsx` (885) — none of these are broken, just large enough to hurt testability and review.
- Entity-type derivation in the audit interceptor mangles hyphenated routes (`/opd-visits` → `"Opd-visit"` instead of `"OpdVisit"`) — cosmetic, pollutes the Activity Log's "Module" filter facet.
- No genuine commented-out/dead code was found anywhere in the codebase (a mechanical scan found ~40 candidate blocks; every one manually inspected turned out to be legitimate prose documentation, not disabled code) — this is a **positive** finding worth preserving as a team convention.
- No `console.log`/`console.debug`/`console.warn` found anywhere in non-test source — all logging correctly goes through NestJS's `Logger`. Also a positive finding.
- No `TODO`/`FIXME`/`HACK`/`XXX` markers found anywhere in either app.

---

## 13. Testing Gaps

Prioritized per the requested order:

1. **Security-critical tests** — no test exists for RBAC Admin's grant/revoke self-escalation risk (F-11); no test exists exercising the JWT-secret-fallback startup path; no cross-tenant isolation e2e test exists at all (security report V-21, reconfirmed here).
2. **Role-based tests** — `rbac-matrix.spec.ts` and `rbac-role-boundaries.spec.ts` are genuinely strong structural tests, but they check the **static seed/decorator configuration**, not runtime behavior of the modules with the worst findings in this report (Procurement self-approval, GRN/PO mismatch, Employee mass-assignment).
3. **Multi-tenant tests** — zero test coverage exists for the entire `platform` module (hospital onboarding, suspend/reactivate, admin CRUD) — this is the backbone of the whole multi-hospital promise and has no automated regression protection at all.
4. **Core business workflows** — no dedicated unit spec exists for `admission.service.ts` (the main admission/discharge/bed-allocation service — only its sibling `ipd-finance.service.ts` and a concurrency-only e2e spec exist), `employee.service.ts`, or `user.service.ts`. The discharge/bed-corruption bug (F-01) would have been straightforward to catch with a "discharge twice" test.
5. **Validation tests** — no test exists asserting the negative-quantity/negative-price gaps in Inventory or Procurement DTOs (F-19, F-20); no test exists for the prescription-update-doesn't-persist bug (F-02) — existing tests check that a SIGNED prescription rejects edits, but never check that a DRAFT edit is actually saved.
6. **Edge cases** — no test for double-discharge, self-approval, GRN-exceeds-PO-quantity, or the identifier-case-mismatch onboarding bug.
7. **Regression tests** — 5 of the 14 e2e specs (`billing`, `dashboard`, `expiry`, `inventory`, `procurement`) depend on a live seeded database rather than being self-contained (the rest correctly mock `PrismaService`), making them the suite's most fragile members and giving shallower assertions (presence-checks rather than value-checks).
8. **UI tests** — frontend test coverage is essentially one login smoke test, one RBAC-mirror unit test, and one routing unit test (3 files total). The ~80+ page/screen components — including the two largest files in the entire repository — have zero component-level tests.

**Modules with literally zero test coverage:** `platform` (all 5 controllers/services), `reports` (all 3 CSV endpoints), `rbac-admin` (its own grant/revoke/list surface).

---

## 14. Test Cases To Add

```
TC-ADMISSION-001
Module: Admission
Action: Discharge an admission, then call discharge() again on the same admission (or after its bed has been re-allocated to a different admission)
Expected: Second call returns 400/409 "already discharged" and does NOT touch the bed's currentAdmissionId if it no longer matches
Currently: FAILS — second call silently frees whatever admission.bedId points to, regardless of current occupant

TC-PRESCRIPTION-001
Role: Doctor
Action: Create a DRAFT prescription, edit an item via PUT /prescriptions/:id, then GET the prescription again
Expected: The edited value is present on re-fetch
Currently: FAILS — edit is never persisted

TC-PROCUREMENT-001
Role: StoreManager
Action: Raise a requisition, then attempt to approve the same requisition as the same user
Expected: 403 Forbidden (self-approval blocked)
Currently: FAILS — succeeds

TC-PROCUREMENT-002
Role: ProcurementOfficer/StoreManager
Action: Create a GRN for a PO with quantities exceeding what was ordered, or for a medicine not on the PO, or twice against the same PO
Expected: 400/409 rejecting the mismatch
Currently: FAILS — silently accepted every time

TC-PHARMACY-001
Role: Pharmacist
Action: Transfer stock from Central to Pharmacy location, dispense from that batch, then check GET /inventory/stock-locations for the Pharmacy location
Expected: PharmacyStock quantity reflects the dispensed reduction
Currently: FAILS — PharmacyStock is never decremented by dispense

TC-EMPLOYEE-001
Role: Reception
Action: PUT /employees/:id with an extra unexpected field (e.g. gradeId) not shown on the Reception UI's edit form
Expected: 400 Bad Request (unknown field rejected by whitelist) OR the field is silently ignored
Currently: FAILS — field is written directly to the database

TC-DASHBOARD-001
Role: Pharmacist
Action: GET /dashboard/summary
Expected: 403 Forbidden, or a response scoped to Pharmacist-relevant data only
Currently: FAILS — returns full admin-tier billing/staff/audit data

TC-ONBOARDING-001
Role: Platform Super Admin
Action: Create a hospital with adminIdentifier="Admin@Hospital.com" (mixed case), then attempt to log in as that admin using the same casing
Expected: Login succeeds
Currently: FAILS — login-directory stores it lowercased, tenant User row keeps original case, login 401s

TC-RBAC-001
Role: Administrator
Action: Grant a role a new permission via POST /rbac/permissions, then check /platform/audit-log or /audit-log for the action
Expected: An audit entry exists recording who granted what to whom
Currently: FAILS — no audit entry is written

TC-FRONTEND-ROUTE-001
Role: Pharmacist (or any non-admin role)
Action: Log in, then manually navigate the browser to the RBAC Management / System Config / Billing URL
Expected: Redirected away or shown a 403 page
Currently: FAILS — the full admin screen renders; only the backend API calls it makes are blocked

TC-VISIT-001
Role: any role with Employee:read
Action: POST /visits with an employeeId that doesn't exist
Expected: 404 Not Found
Currently: FAILS — raw database FK-violation error surfaces instead
```

---

## 15. Recommended Fix Order

### Phase 1 — Critical (security, data isolation, authentication, authorization, data corruption)
1. Fail-fast JWT secret validation at boot (V-01 / F-08).
2. Fix `discharge()` to guard on admission status and only free the bed conditionally on current ownership (F-01, F-16).
3. Fix `updatePrescription()` to actually persist (F-02).
4. Block self-approval in procurement (F-03); add PO/GRN cross-validation (F-04).
5. Fix the pharmacy stock race (F-05, V-08) and the dual-ledger bug (F-06) together, since both touch the same code path.
6. Fix the Employee mass-assignment bug with a real `UpdateEmployeeDto` (F-07, V-07).
7. Normalize identifiers to lowercase in `TenantUserProvisioningService` and the two other affected call sites (F-09).
8. Add platform-level audit logging for all administrative mutations (F-10) and RBAC grant/revoke (F-11).

### Phase 2 — Functional (broken workflows and incorrect business logic)
9. Add the missing `visit.status===OPEN` checks, `visitId` existence checks, and admission-ownership cross-check for lab orders (F-15, F-17, F-27).
10. Fix the frontend route-guard gap (F-12) and the dashboard permission gap (F-13).
11. Resolve the discharge-day billing gap (F-29) and give operators a recovery path for stuck-PROVISIONING hospitals (F-30).
12. Fix the dead "Edit Profile" role-string comparison (F-26).

### Phase 3 — Validation (missing/incorrect validation and required fields)
13. Add `@Min(0)`/`@IsPositive()`/`@IsInt()` across Inventory and Procurement numeric DTO fields (F-19, F-20).
14. Add `@ArrayMinSize(1)` to prescription items; fix the reports/analytics date-range validation.
15. Fix or remove the non-functional CSRF middleware and the unbounded CSV exports + formula injection (V-14, F-14).

### Phase 4 — Testing (missing automated tests)
16. Add unit tests for `admission.service.ts`, `employee.service.ts`, `user.service.ts`, the entire `platform` module, `reports`, and `rbac-admin` — currently zero coverage.
17. Add the specific regression tests listed in §14, prioritizing double-discharge, self-approval, and GRN-vs-PO mismatch since those map directly to the Critical findings.
18. Convert the 5 database-dependent e2e specs to self-contained mocked tests matching the pattern already used by the other 9.

### Phase 5 — Code Quality (refactoring and maintainability)
19. Extract a shared `AccountLifecycleService` base for Doctor/Staff to stop the fix-drift pattern (F-25).
20. Consolidate the two Excel-export implementations onto one approach; extract a shared frontend date-formatting utility; centralize the duplicated 30/90-day magic-number constants.
21. Reduce `: any` usage in `patient.service.ts` specifically, given it's both the largest file and the worst offender by this metric.

### Phase 6 — Performance (optimization based on identified bottlenecks)
22. Cap and index-back the unbounded `findMany` calls in Reports and `dashboard.service.ts::countLowStockBatches()`.
23. Move in-memory-filtered queries (low-stock scan) to database-level filtering.

---

## 16. Module Scorecard

`PASS` / `PARTIAL` / `FAIL` / `N/A` / `NOT TESTED` per the requested categories. Compressed to one row per module cluster for readability; see the module-level detail woven through §3–§10 for the specific evidence behind each PARTIAL/FAIL.

| Module | Functionality | CRUD | Validation | Roles | API | DB | Security | Tenant Isolation | UI/UX | Errors | Edge Cases | Tests | Code Quality | Performance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Patient | PASS | PARTIAL | PARTIAL | PASS | PASS | PASS | PARTIAL (V-06) | PASS | PARTIAL | PASS | PARTIAL | PARTIAL | PARTIAL (`any`, size) | PASS |
| Visit/Registration | PARTIAL (F-15) | FAIL | PASS | PARTIAL (F-17-adjacent) | PASS | PASS | PASS | PASS | PASS | FAIL | PARTIAL | PARTIAL | PASS | PASS |
| OPD | PASS | PASS | PASS | PARTIAL (F-17) | PASS | PASS | PASS | PASS | PASS | PARTIAL | PASS | PASS | PASS | PASS |
| Admission/IPD | FAIL (F-01) | FAIL | PASS | PARTIAL | PASS | PASS | PARTIAL | PASS | PASS | PASS | PARTIAL | FAIL | PARTIAL | PARTIAL (F-29) |
| Prescription | FAIL (F-02) | FAIL | PARTIAL | PARTIAL (F-18) | PASS | PASS | PASS | PASS | PASS | PASS | PARTIAL | PARTIAL | PASS | PASS |
| Laboratory | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Therapy | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Billing/Charge/Receipt | PARTIAL (F-23) | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PARTIAL | PASS | PASS | PASS | PARTIAL (excel dup) | PASS |
| Pharmacy | FAIL (F-06) | PARTIAL | PARTIAL | PARTIAL | PASS | PASS | FAIL (F-05) | PASS | PARTIAL | PASS | PARTIAL | FAIL | PARTIAL | PARTIAL |
| Inventory | PARTIAL | PARTIAL | FAIL (F-19) | PASS | PASS | PASS | PASS | PASS | PARTIAL | PASS | PARTIAL | FAIL | PASS | PASS |
| Procurement | FAIL (F-03,F-04) | FAIL | FAIL (F-20) | FAIL (F-03) | PASS | PASS | PARTIAL | PASS | PARTIAL | PASS | PARTIAL | FAIL | PASS | PASS |
| Catalog/Pricing | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | PASS | PASS | PASS | PASS | PASS |
| Benefit Rules | PARTIAL | PARTIAL | PASS | PASS | PASS | PASS | PASS | PASS | N/A | PASS | PARTIAL | PARTIAL | PARTIAL | PASS |
| Facility Eligibility | PARTIAL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | PASS | PASS | PASS | PARTIAL (no txn) | PASS |
| Employee | FAIL (F-07) | FAIL | FAIL | FAIL (F-31) | PASS | PASS | FAIL (V-07) | PASS | PASS | PASS | PARTIAL | NOT TESTED | PASS | PASS |
| Doctor Management | PASS | PASS | PASS | PASS | PASS | PASS | PARTIAL (F-24) | PASS | PASS | PASS | PASS | PASS | PARTIAL (F-25) | PASS |
| Staff Management | PASS | PASS | PASS | PASS | PASS | PASS | PARTIAL (F-24) | PASS | PASS | PASS | PASS | PASS | PARTIAL (F-25) | PASS |
| User/Role Listing | PASS | N/A | N/A | FAIL (mismatch) | PASS | PASS | PASS | PASS | N/A | PASS | N/A | NOT TESTED | PASS | PASS |
| RBAC Admin | PARTIAL | PARTIAL | PASS | PARTIAL (F-11) | PASS | PASS | PARTIAL | PASS | PARTIAL (no confirm) | PASS | PARTIAL | FAIL | PASS | PASS |
| Department | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT TESTED | PASS | PASS |
| Auth Workflows | PASS | PASS | PASS | PASS | PASS | PASS | PARTIAL (see companion report) | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Platform/Onboarding | PARTIAL (F-09) | PARTIAL | PASS | PASS | PASS | PASS | PARTIAL | PASS | PASS | PASS | PARTIAL | FAIL | PARTIAL (dup logic) | PASS |
| Platform Admin Mgmt | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | FAIL | PASS | PASS |
| Platform Audit Log | FAIL (F-10) | N/A | N/A | PASS | PASS | PASS | FAIL | PASS | PASS | PASS | N/A | FAIL | PASS | PASS |
| Platform Dashboard | PASS | N/A | N/A | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | FAIL | PASS | PASS |
| Reports | PARTIAL | N/A | PARTIAL | PASS | PASS | PASS | FAIL (V-05) | PASS | PASS | PARTIAL | PASS | FAIL | PASS | FAIL (unbounded) |
| Analytics | PASS | N/A | PARTIAL | PASS | PASS | PASS | PASS | PASS | PASS | PARTIAL | PASS | PASS | PARTIAL (dup consts) | PASS |
| Dashboard | PARTIAL | N/A | N/A | FAIL (F-13) | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | PARTIAL | PARTIAL (dup consts) | PARTIAL (F-34 scan) |
| Audit Log | PASS | N/A | PASS | PASS | PASS | PASS | PARTIAL (V-05 shared) | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Frontend (global: routing, RBAC gating, auth storage) | PARTIAL | — | PARTIAL | FAIL (F-12) | — | — | FAIL (F-12) | N/A | PARTIAL | PARTIAL | PARTIAL | FAIL (3 files total) | PARTIAL (large files) | PASS |

---

*This report is a static, point-in-time code review. It should be paired with a live dynamic-testing pass (real role-token API calls, a two-hospital cross-tenant scripted test, and browser-driven UI testing) before being treated as a complete verification — several findings here (especially the Critical ones in §3) are exactly the kind of bug a "click through the app twice" manual pass would also catch, and doing so is recommended as the next step regardless of how quickly the code fixes land.*

