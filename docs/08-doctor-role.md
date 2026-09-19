# 08 — The Doctor Role: Full Reference

This document is a complete reference for everything the **Doctor** role does in the Hospital Management System, and every place doctors and doctor data appear across the backend (`apps/api`, NestJS + Prisma + PostgreSQL) and frontend (`apps/web`, React + TypeScript + Vite).

---

## 1. Overview

A Doctor is a hospital staff account with its own dedicated data model (`DoctorProfile`), its own controller/service stack (separate from the generic Staff module), and a dedicated clinical console in the UI (`DoctorWorkspace`). A doctor's job in the system spans three areas:

1. **OPD (outpatient) consultations** — receive patients from a personal queue, examine them, record a diagnosis, write and sign prescriptions, order lab tests, and recommend therapy.
2. **IPD (inpatient/ward) care** — for admitted patients under their care: order labs, prescribe medicine, recommend therapy, and approve discharge.
3. **Shared read access** — view the doctor directory/schedule, patient records (only for patients they've actually seen), lab and therapy screens.

Doctor **accounts** (create/update/deactivate/reset password/lock) are managed exclusively by `Administrator`/`SuperAdmin` via the Doctor Schedule screen — doctors cannot manage their own or other staff accounts.

---

## 2. Data Model (`apps/api/prisma/schema.prisma`)

### `User`
Every login account, including doctors, is a `User` row with `role.name === 'Doctor'` plus a linked `DoctorProfile`.

```prisma
model User {
  id, identifier (login email, unique), passwordHash, roleId, employeeId?,
  active, mustChangePassword, passwordChangedAt, lastLoginAt,
  tempPasswordExpiresAt, tokenVersion (bumped to invalidate issued JWTs),
  admissionsDoctor  Admission[] @relation("AdmissionDoctor")
  opdVisitsAsDoctor OPDVisit[]  @relation("OPDVisitDoctor")
  labOrdersAsDoctor LabOrder[]  @relation("LabOrderDoctor")
  doctorProfile     DoctorProfile?
  employee          Employee?
  role              Role
}
```

### `DoctorProfile` — the doctor-specific extension table
```prisma
model DoctorProfile {
  id, userId (unique, 1:1 with User), specialty, subSpecialty?, experience,
  available (Boolean, default true), verified (Boolean, default false),
  departmentId? (primary department FK), consultationFee (Decimal 10,2),
  consultationDurationMinutes?, dailyCapacity?, professionalPhone?,
  professionalEmail?, signatureRef?,
  weeklySchedule (Json?) // legacy 7-entry [{day,startTime,endTime,available}]
  user, department, credentials[], departments[], schedules[], leaves[], roomAssignments[], substituteFor[]
}
```
`weeklySchedule` is documented in-schema as **superseded** by the relational `DoctorSchedule` model, but it's still what `DoctorService`/`DoctorController` and `DoctorSchedulePage` actually read/write today.

### Newer relational doctor tables (schema exists; mostly not yet wired to a controller)
Added in migration `20260918220550_doctor_queue_security_expansion`:

| Table | Purpose | Status |
|---|---|---|
| `DoctorCredential` | License/registration/qualification rows (`credentialType`, `licenseNumber`, `issuingBody`, `qualificationName`, `expiryDate`, `verified`) | Schema only — no controller/service found |
| `DoctorDepartment` | Multi-department assignment (`doctorProfileId`, `departmentId`, `isPrimary`) | **Actually used** — `DoctorService.findEligibleDoctors` matches on it |
| `DoctorSchedule` | Canonical per-day schedule row (`dayOfWeek`, `startTime`, `endTime`, `roomLabel`, `active`; unique on `doctorProfileId+dayOfWeek`) | Schema only (future replacement for `weeklySchedule` JSON) |
| `DoctorLeave` | `startDate`, `endDate`, `reason`, optional `substituteDoctorProfileId` (self-relation) | Schema only |
| `DoctorRoomAssignment` | Free-text `roomLabel` (deliberately not FK'd to ward/bed `Room`), optional `departmentId`, `isPrimary` | Schema only |

### Related models with a doctor relation
- **`Department`** — `name`, `code`, `active`; back-relations to doctors.
- **`OPDVisit`** — the OPD queue entity: `opdNumber` (permanent), `tokenNumber` (daily), `doctorId?`, `status` (`WAITING│CALLED│IN_CONSULTATION│COMPLETED│NO_SHOW│SKIPPED│CANCELLED│TRANSFERRED`), transition timestamps, `priority`, `queuePosition`, `assignedRoomLabel`, `transferReason`, `skipReason`. Indexed on `[doctorId]` and `[doctorId, status]`.
- **`Diagnosis`** — `visitId`, `doctorId`, `symptoms?`, `examinationNotes?`, `diagnosisText`, `followUpFlag`, `admissionRecommended`.
- **`Prescription`** + **`PrescriptionItem`** — `Prescription.doctorId`, `status` (`DRAFT`→`SIGNED`, immutable once signed), `signedAt`. Items: `medicineName`, `dose`, `frequency`, `duration`, `dispensedQuantity`, `benefitOutcome`, `dispenseStatus`.
- **`LabOrder`** — a doctor's order for investigations; `orderedBy` FK to `User` (`orderingDoctor`), `priority`, `clinicalNotes`, `status`.
- **`Admission`** — `assignedDoctorId?` FK (`assignedDoctor`).
- **`TherapySession`** — `performedById` (usually Nurse) vs `createdById` (the ordering doctor).
- **`StaffShift`** — generic weekly-availability model for every role **except** Doctor, which uses `DoctorSchedule`/`weeklySchedule` instead.
- **`AuditLog`** — records every doctor lifecycle action (created, activated/deactivated, password_reset, locked/unlocked, email_changed, department_changed, activation_resent).

---

## 3. Authentication & RBAC

### Login
There is **no** doctor-specific login endpoint — one unified `/auth/login` for every role, resolved via a global cross-hospital `LoginDirectoryService`. Doctor login differs only in the `roleName` embedded in the JWT, which drives `RbacGuard` checks and role-switched responses (e.g. `dashboard/my-summary`).

- Password checked with bcrypt.
- A temp password (`mustChangePassword=true`) expires 24h after issuance (`tempPasswordExpiresAt`).
- `tokenVersion` bump on password reset/lock/deactivate invalidates already-issued JWTs immediately.
- Account activation uses a single-use emailed token (`/activate?token=...`), not a JWT.
- `LoginActivity` (tenant-local) and `PlatformLoginActivity` (unresolved identifiers) log login attempts.

### Permission grants (`apps/api/prisma/seed.ts` → `PERMISSION_GRANTS.Doctor`)
This is the canonical, test-enforced permission list for the Doctor role:

```
Employee:read
Doctor:read
Visit:read, Visit:create
OPDVisit:read, OPDVisit:call, OPDVisit:update, OPDVisit:transfer
Diagnosis:create, Diagnosis:read
Prescription:create, Prescription:read, Prescription:sign
Admission:create (recommendation stub), Admission:read, Admission:approve (discharge)
Charge:read
LabTest:read, LabOrder:create, LabOrder:read, LabReport:read
TherapySession:create, TherapySession:read
Service:read
```

Only `Administrator` (not Doctor) holds `Doctor:create/update/delete` — doctor account creation/edit/deactivation is deliberately kept out of Reception/DataEntryOperator hands because it creates a real login-capable account. Other roles granted `Doctor:read` (so they can see the doctor picker/roster): `Reception`, `AdmissionDesk`, `Nurse`, `Administrator`, `QueueManager`.

`PERMISSION_GRANTS` is imported directly by `rbac-matrix.spec.ts` and `rbac-role-boundaries.spec.ts`, so the seed and enforcement can never silently drift.

### Enforcement — `RbacGuard` (`common/guards/rbac.guard.ts`)
- Reads `@Roles()` / `@RequirePermission(resource, action)` metadata.
- Any hospital user with `mustChangePassword=true` is blocked from everything except `/api/auth/change-password|me|refresh|logout`.
- Platform-type JWTs bypass all role/permission checks (the only universal bypass) — **no hospital-local role, including Doctor, ever carries a wildcard `*:*` grant** (enforced by a dedicated test).
- Otherwise: `user.permissions.some(p => (p.resource==='*'||p.resource===resource) && (p.action==='*'||p.action===action))`.

```ts
@RequirePermission('Doctor', 'read')
```

Regression test coverage worth knowing about:
- `rbac-matrix.spec.ts` statically parses every controller and once caught `GET`/`POST /doctors` being `@Public()` ("keeping simple for demo"), which let an unauthenticated caller list all doctors and self-register a doctor login — now gated behind `Doctor:read`/`Doctor:create`.
- `rbac-role-boundaries.spec.ts` asserts Doctor cannot manage generic `Staff` accounts (`Staff:create/update/delete` all `false` for Doctor).

### Extra ownership scoping (beyond the coarse resource:action grant)
Several services layer a "doctor can only touch their own patients/visits" check in code:

| Service | Behavior |
|---|---|
| `OpdService.assertOwnership` | A Doctor caller acting on an `OPDVisit` they don't own gets a **404** (not 403) — "doesn't confirm to a doctor that another doctor's visit even exists." Applied to call/start/complete/no-show/skip/cancel/transfer. |
| `AdmissionService.findOne` | Same 404-not-403 pattern when `assignedDoctorId !== caller.id`. |
| `AdmissionService.findAll` | Auto-filters to `{ assignedDoctorId: caller.id }` for Doctor callers. |
| `PatientService.searchPatients` | Scopes results to patients the doctor has actually seen (OPD visit or admission ownership). |

---

## 4. Backend API Endpoints

### `DoctorController` — `/doctors` (`apps/api/src/modules/user/doctor.controller.ts`)

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/doctors` | `Doctor:read` | Active doctors only — for pickers |
| GET | `/doctors/eligible?departmentId=&autoAssign=` | `Doctor:read` | Backs the OPD registration doctor picker; `autoAssign=true` picks the least-busy doctor |
| GET | `/doctors/admin` | `Doctor:update` | Includes deactivated doctors + lock/failed-login status, for admin reactivation UI |
| POST | `/doctors` | `Doctor:create` | Onboards a new doctor (creates login, Employee, DoctorProfile) |
| PATCH | `/doctors/:id` | `Doctor:update` | Edit profile/specialty/department/fee/schedule/email |
| PATCH | `/doctors/:id/active` | `Doctor:delete` | Soft deactivate/reactivate (never hard-delete) |
| POST | `/doctors/:id/reset-password` | `Doctor:update` | Admin-triggered temp password reset |
| PATCH | `/doctors/:id/lock` | `Doctor:update` | Manual account lock/unlock (independent of `active`) |
| POST | `/doctors/:id/resend-activation` | `Doctor:update` | Re-sends activation email, invalidates old token |

**`DoctorService` key behaviors** (`doctor.service.ts`):
- `createDoctor`: registers the identifier in the global `LoginDirectoryService` first (fails fast on collision), then in one Prisma transaction creates the `User` (role Doctor, `mustChangePassword: true`, random bcrypt-hashed password, 24h temp TTL), allocates a sequential staff ID (`DOC-0001`), creates `Employee`, creates `DoctorProfile`, writes a `doctor.created` audit log. Rolls back the directory registration if the tenant transaction fails. Sends an activation email afterward.
- `updateDoctor`: syncs employee name; email change renames the login-directory identifier (audit: `doctor.email_changed`); department change audit-logged as `doctor.department_changed`.
- `setActive(false)`: soft-deactivate + `tokenVersion++` (kills active sessions); clinical history/queue/prescriptions/audit trail are never deleted (heavily FK-referenced).
- `resetPassword`: fresh one-time password, `mustChangePassword: true`, `tokenVersion++`.
- `setLocked`: delegates to `LoginDirectoryService.lockManually`/`unlock`; independent of active/inactive.
- `findEligibleDoctors(departmentId)`: active, role Doctor, has a profile, and belongs to the department (primary `departmentId` OR a `DoctorDepartment` row).
- `findLeastBusyEligibleDoctor(departmentId)`: among eligible doctors, picks the one with fewest active (`WAITING|CALLED|IN_CONSULTATION`) `OPDVisit` rows.

**DTOs**: `CreateDoctorDto` (`name`, `specialty`, `experience`, `email`, optional `departmentId` UUID, `consultationFee ≥ 0`, up to 7 `WeeklyScheduleEntryDto` entries), `UpdateDoctorDto` (all optional + `verified`), `WeeklyScheduleEntryDto` (`day` MON–SUN, `startTime`/`endTime` HH:MM regex, `available`). Note: `STAFF_ROLE_PREFIXES`/`STAFF_ROLE_NAMES` in the generic Staff module explicitly **excludes** `'Doctor'` — "Doctor accounts are managed from the Doctor Schedule screen."

### `OpdController` — `/opd-visits` (doctor-relevant subset)

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/opd-visits/my-queue` | `OPDVisit:read` | `getMyQueue()` — doctorId always from JWT, never client-supplied |
| POST | `/opd-visits/call-next` | `OPDVisit:call` | Atomically claims the next `WAITING` patient in the caller's own queue |
| POST | `/opd-visits/:id/call` | `Employee:read` | Manual call (Reception/QueueManager/Admin, or doctor re-calling); ownership-checked for Doctor callers |
| PATCH | `/opd-visits/:id/start-consultation` | `OPDVisit:update` | `CALLED → IN_CONSULTATION` |
| PATCH | `/opd-visits/:id/complete` | `OPDVisit:update` | `→ COMPLETED`, also closes the underlying `Visit` |
| PATCH | `/opd-visits/:id/no-show` \| `/skip` \| `/cancel` | `OPDVisit:update`/`cancel` | Terminal transitions with optional reason |
| PATCH | `/opd-visits/:id/transfer` | `OPDVisit:transfer` | Reassign to another eligible doctor (reason required) |
| GET | `/opd-visits/my-patients` | `Employee:read` | Historical (any status) list for the caller |
| GET | `/opd-visits/queue?departmentId=&doctorId=` | `Employee:read` | Shared department queue view (Reception/QueueManager), optional doctor filter |

**`OpdService` business logic**:
- `assertDoctorEligibleForDepartment` — server-side validation that a doctor id is active/role Doctor/has a profile/matches the department before it can be assigned, "so a client can't smuggle in an ineligible doctor id."
- `createOpdVisit` — doctor assigned **at registration time**, not call-time; issues a daily token + permanent `opdNumber` atomically; auto-posts a `CONSULT-GEN` charge if priced.
- `callNext(doctorId)` — transactional, race-safe via conditional `updateMany`; refuses if the doctor already has a `CALLED`/`IN_CONSULTATION` visit open.
- `transfer` — requires a non-empty reason; validates the new doctor's eligibility; resets the visit to `WAITING` under the new doctor.
- Every state change writes an `AuditLog` row (`opdvisit.completed`, `.no_show`, `.skipped`, `.cancelled`, `.transferred`).

### `PrescriptionController` — `/prescriptions`

| Method | Route | Permission | Purpose |
|---|---|---|---|
| POST | `/prescriptions` | `Prescription:create` | `createPrescription(dto, doctorId)` — doctorId from `req.user` |
| PUT | `/prescriptions/:id` | `Prescription:update` | Rejected with `ForbiddenException` if already `SIGNED` |
| POST | `/prescriptions/:id/sign` | `Prescription:sign` | `signPrescription(id, userRole)` |
| GET | `/prescriptions/visit/:visitId` | `Employee:read` | `findByVisit()` |

`createPrescription` (one transaction): creates a `Diagnosis`, a `Prescription` (status `DRAFT`) with nested `PrescriptionItem`s, and — if `labTestIds` supplied — groups them under one `LabOrder` via `LabService.orderTests`.

`signPrescription` — role-checked in code (`Doctor`/`SuperAdmin`/`Administrator` only, 403 otherwise), on top of the RBAC grant. Sets `status: SIGNED`, `signedAt`; if `Diagnosis.admissionRecommended` is true and no `Admission` exists yet, **auto-creates an `Admission` stub** (`status: REQUESTED`, `eligibleCategory: 'C'`, sequenced number).

### `AdmissionController` — doctor-relevant endpoints

| Method | Route | Permission | Doctor relevance |
|---|---|---|---|
| GET | `/admissions` | `Admission:read` | Scoped to `assignedDoctorId` for Doctor callers |
| GET | `/admissions/:id` | `Admission:read` | 404 if not the assigned doctor |
| POST | `/admissions/:id/allocate` | `Admission:update` | `assignedDoctorId?` sets the treating doctor |
| POST | `/admissions/:id/discharge` | `Admission:approve` | Role-checked to Doctor/SuperAdmin/Administrator only; generates `DischargeSummary`, frees the bed, sets `status: DISCHARGED` |

### `DashboardController` — `/dashboard/my-summary` (Doctor case)
```ts
case 'Doctor': {
  const [queue, pendingPrescriptionDrafts] = await Promise.all([
    this.opdService.getMyQueue(user.id),
    this.prisma.prescription.count({ where: { doctorId: user.id, status: 'DRAFT' } }),
  ]);
  return {
    role: 'Doctor',
    waitingCount: queue.filter(v => v.status === 'WAITING').length,
    calledCount: queue.filter(v => v.status === 'CALLED' || v.status === 'IN_CONSULTATION').length,
    pendingPrescriptionDrafts,
  };
}
```

### Lab ordering — `LabService.orderTests(dto, doctorId, tx?)`
Sets `orderedBy: doctorId`; report rendering exposes `referringDoctor` (via `orderingDoctor.identifier`) on printed lab reports.

---

## 5. Core Business Logic / Workflows

**OPD visit lifecycle**: Reception/registration assigns a doctor at visit creation (server-checked eligibility) → visit sits `WAITING` in that doctor's queue → doctor `callNext`/`callToken` → `CALLED` → `startConsultation` → `IN_CONSULTATION` → `completeConsultation` → `COMPLETED` (also closes the `Visit`). Alternative terminal paths: `NO_SHOW`, `SKIPPED`, `CANCELLED`, or `TRANSFERRED` to another eligible doctor (reason required).

**Consultation → Diagnosis → Prescription → (optional) Lab Order**: one transaction, doctor-authored, via `PrescriptionService.createPrescription`.

**Prescription signing** is a hard immutability boundary: once `SIGNED`, any edit attempt throws `ForbiddenException` unconditionally ("Signed prescriptions are immutable and locked for audit compliance"). Signing can auto-spawn an `Admission` stub if the diagnosis recommended admission.

**IPD/Admission**: a doctor can recommend admission (`Admission:create`, stub only), gets assigned as `assignedDoctorId` at bed allocation, and is one of three roles allowed to approve discharge (`Admission:approve`) — generates the discharge summary and frees the bed.

**Therapy**: doctor *orders/recommends* (`TherapySession:create`); a Nurse *performs and marks complete* — enforced by the permission matrix, plus `createdById`/`performedById` bookkeeping.

**Billing**: doctor only has `Charge:read` — no create/update billing permission; charges are posted automatically (e.g. on OPD visit creation) or handled by Reception/Pharmacist/Accountant.

**Patient/medical record access**: doctors search/view only patients they've actually seen (OPD visit or admission ownership), enforced in `PatientService.searchPatients`.

---

## 6. Seed / Demo Data

`apps/api/prisma/seed.ts`:
- One generic seeded Doctor login: `doctor@{tenant}.esic.gov.in` / `DoctorPass123!`.
- **8 named demo doctor profiles**, all sharing the same password hash:

| Name | Specialty | Experience | Login |
|---|---|---|---|
| Dr. Ramesh Sharma | General Physician | 15 yrs | r.sharma@{tenant}.esic.gov.in |
| Dr. Ankit Verma | General Physician | 10 yrs | a.verma@{tenant}.esic.gov.in |
| Dr. Anita Desai | Cardiologist | 12 yrs | a.desai@{tenant}.esic.gov.in |
| Dr. Sanjay Mehra | Cardiologist | 18 yrs | s.mehra@{tenant}.esic.gov.in |
| Dr. Vikram Singh | Orthopedics | 8 yrs | v.singh@{tenant}.esic.gov.in |
| Dr. Sunita Rao | Pediatrician | 20 yrs | s.rao@{tenant}.esic.gov.in |
| Dr. Manish Gupta | Neurologist | 10 yrs | m.gupta@{tenant}.esic.gov.in |
| Dr. Priya Patel | Dermatologist | 5 yrs | p.patel@{tenant}.esic.gov.in |

Each gets a `User` (role Doctor), an `Employee` (`DOC-<local-part>`), and a `DoctorProfile` (`available: true`). Identifiers are tenant-tagged because logins are unique **platform-wide** via `LoginDirectoryService`.

`apps/api/prisma/demo-seed.ts` — a scripted "doctor sees patient" presentation demo: looks up `r.sharma@esic.gov.in` (hard-coded, non-tenant-tagged — fails against a tenant-tagged DB with "Doctor not found. Please run regular seed first."), creates 2 demo patients, and for each an OPD `Visit`+`OPDVisit` (tokens `GENMED-101`/`102`), a `Diagnosis` ("Acute nasopharyngitis"), and a `Prescription`+items, all attributed to that doctor.

---

## 7. Validation & Error Handling Specific to Doctors

- `CreateDoctorDto`/`UpdateDoctorDto`/`WeeklyScheduleEntryDto`: required name/specialty/experience, valid email, optional UUID department, non-negative fee, ≤7 schedule entries with day enum + HH:MM regex time.
- `requireDoctorUser` throws `NotFoundException('Doctor not found: {id}')` before any mutating admin action.
- Ownership violations are consistently **404, not 403** across `OpdService`/`AdmissionService` (deliberately avoids confirming another doctor's record exists).
- `signPrescription`/`discharge` — explicit in-code role whitelist (`ForbiddenException`) layered on top of the RBAC guard.
- `updatePrescription` — `ForbiddenException` on any edit once `status === SIGNED`.
- `callNext` — `BadRequestException` if the doctor already has an in-progress patient; `ConflictException` on a lost concurrent-claim race.
- `getQueue` — `BadRequestException` if `departmentId` is missing (previously reached Prisma as `undefined` and surfaced as an opaque 500).
- `transfer` — `BadRequestException` if no non-empty reason is supplied.

---

## 8. Frontend: Pages & Routes

The app doesn't use classic `<Route>` elements — `AppShell.tsx` is a `PageId`-driven router (state machine synced to the URL via `react-router-dom`).

| URL (`PageId`) | Component | File | Doctor relevance |
|---|---|---|---|
| `/dashboard` | `DashboardPage` | `pages/DashboardPage.tsx` | Role-specific tiles/summary |
| `/consultations` | `DoctorWorkspace` | `pages/doctor/DoctorWorkspace.tsx` | **Core clinical console** |
| `/doctor-schedule` | `DoctorSchedulePage` | `pages/DoctorSchedulePage.tsx` | Read-only roster for Doctor; full CRUD for Admin/SuperAdmin |
| `/opd-queue` | `OpdQueueScreen` | `screens/opd/OpdQueueScreen.tsx` | Doctor can call/start/complete/transfer visits |
| `/patient-search` | `EnterpriseReceptionDesk` | `pages/reception/EnterpriseReceptionDesk.tsx` | Doctor permitted |
| `/patient-records` | `PatientRecordsPage` | `pages/PatientRecordsPage.tsx` | Read-only for Doctor (edit is Reception/Admin only) |
| `/ward-console` | `WardStaffScreen` | `screens/admission/WardStaffScreen.tsx` | Doctor-only: order lab, prescribe, recommend therapy, approve discharge |
| `/laboratory` | `LabWorkbenchScreen` | `screens/laboratory/LabWorkbenchScreen.tsx` | Doctor can view/order |
| `/therapy` | `TherapyConsoleScreen` | `screens/therapy/TherapyConsoleScreen.tsx` | Doctor can view/order |
| `/activate` (pre-auth) | `ActivateAccountPage` | `pages/auth/ActivateAccountPage.tsx` | New doctor account's first password setup |
| (auth gate) | `ForcedChangePasswordScreen` | `pages/auth/ForcedChangePasswordScreen.tsx` | Shown when `mustChangePassword` (new account or admin reset) |
| (auth gate) | `LoginPage` | `pages/LoginPage.tsx` | Unified login for all roles |

Deep-linking: `OpdQueueScreen`'s "Start Consultation" navigates to `/consultations?visitId=<id>`; `DoctorWorkspace` reads that query param on mount to auto-load the visit.

**Doctor does NOT see**: `registration`, `employee-directory`, `ipd-admissions`, Pharmacy/Inventory, `billing`, `patient-ledger`, or anything in the Administration group.

---

## 9. Frontend: Components in Detail

### `DoctorWorkspace.tsx` — the main clinical console (~1400 lines)
An "Epic EMR-style" 3-panel workspace plus a fixed "My OPD Queue" banner and a sticky bottom action bar, plus a hidden print-only report.

- **My OPD Queue banner**: shows the doctor's own queue (`fetchMyOpdQueue`, polled every 8s). Actions: "Call Next" (`callNextOpdVisit`); for the current patient: "Open Chart", "No-show" (`markOpdNoShow`), "Skip" (`skipOpdVisit`), "Complete Consultation" (`completeOpdConsultation`).
- **Left panel — Patient Context**: Visit-ID loader (`fetchVisitById`); patient search (name/mobile/UHID/EmployeeID via `searchPatients`/`lookupPatientByUid`); "Start New OPD Visit" flow (`createPatientVisit`) with a department picker if no open visit exists; patient banner + the **ESIC Benefit Rule Engine** result (`evaluateBenefitRule`, FREE/COVERED/PAID badge).
- **Center panel — Clinical Examination & Diagnosis**: the core clinical form (see §13).
- **Right panel**: Prescribed Medicines editor (dynamic rows, stock-dropdown or free-text); Diagnostic Lab Orders picker (from Lab Test Master) + existing orders for the visit; Recommend Therapy picker with session/course logic + existing sessions/courses.
- **Bottom bar**: Print Consultation (`window.print`), Save Draft (`createPrescription`), Sign & Submit (`signPrescription` — locks all fields once signed, `disabled` state everywhere).

### `DoctorSchedulePage.tsx` — doctor directory & roster management (~600 lines)
- For a plain Doctor: **read-only** grid grouped by specialty, filterable, showing name/specialty badge/experience/department/weekly-schedule summary.
- For Administrator/SuperAdmin: full CRUD — Add/Edit/Reset Password/Lock-Unlock/Deactivate-Reactivate/Resend Activation, each backed by `doctor.api.ts` and confirmed via `ConfirmModal`. New-account/reset flows show a one-time password via `AccountCreatedModal`.
- Uses `WeeklyScheduleEditor.tsx` — a 7-row day/available/startTime/endTime editor.

### `OpdQueueScreen.tsx` — OPD token-calling station (~430 lines)
Used by Doctor, Reception, Nurse, QueueManager, Admin (role-gated per-action, see §10). Department + Doctor filter dropdowns; "Live Calling Station" banner for active consultations; "Upcoming Waiting Tokens" list. "Start Consultation" navigates to `/consultations?visitId=...`.

### `WardStaffScreen.tsx` — IPD/Ward console, Doctor-gated clinical actions
`isDoctorOrAdmin = userRole === 'Doctor' || 'SuperAdmin' || 'Administrator'` gates, per admission card:
- **Order Laboratory Test** — modal sourced from the Lab Test Master, submits via `orderLabTests` (priority + clinical notes).
- **Prescribe Medicine** — IPD prescription modal, pre-fills diagnosis/symptoms, dynamic medicine rows, submits via `createPrescription` (+ optional `signPrescription`).
- **Recommend Therapy** (Doctor/Admin only).
- **Discharge Patient** → "Doctor Discharge Handoff" modal: shows an outstanding-balance warning (non-blocking), requires a Discharge Summary Notes textarea.
- "Log Observation Note" — any ward staff, not Doctor-restricted.
- Displays "Attending Doctor" per admission and `orderingDoctor.identifier` on lab orders.

### `LabWorkbenchScreen.tsx` / `TherapyConsoleScreen.tsx`
Doctor is a permitted viewing/ordering role via sidebar/RBAC grants (`LabTest:read`, `LabOrder:create/read`, `LabReport:read`, `TherapySession:create/read`); these screens don't hardcode `'Doctor'` themselves.

### `PatientRecordsPage.tsx`
Doctor can search/browse full patient records (Overview/Visits/Admissions/Medicines/Billing tabs). Editing patient demographic data is restricted to `receptionist`/`admin` — Doctor cannot edit here.

### `DashboardPage.tsx`
`WORKSPACE_PATH['Doctor'] = '/consultations'` ("Go to My Workspace" button). `MyWorkPanel` for `role === 'Doctor'` shows 3 tiles from `/dashboard/my-summary`: **Waiting**, **In Consultation**, **Draft Prescriptions**. Welcome banner: "You have {N} patients waiting in the OPD queue today." Plus role-specific stat cards (Today's OPD Visits, Waiting Queue, Billing Transactions) and a shared ward-category pie chart.

---

## 10. Navigation, Route Guards & Sidebar Visibility

### `components/layout/Sidebar.tsx` — role-based menu
Items visible to Doctor:

| Group | Item | Also visible to |
|---|---|---|
| Overview | Dashboard | Reception, Doctor, AdmissionDesk, Nurse, Pharmacist, StoreManager, ProcurementOfficer, DataEntryOperator, Administrator, SuperAdmin, Accountant |
| Clinical | Patient Search | Doctor, Reception, Pharmacist, Nurse, SuperAdmin, Administrator |
| Clinical | Patient Records | Doctor, Reception, SuperAdmin, Administrator |
| Clinical | OPD Queue | Doctor, Reception, Nurse, SuperAdmin, Administrator, QueueManager |
| Clinical | Consultations | Doctor, SuperAdmin, Administrator |
| Clinical | Doctor Schedule | Reception, Doctor, Nurse, SuperAdmin, Administrator |
| Clinical | Ward Console | Nurse, Doctor, SuperAdmin, Administrator |
| Clinical | Laboratory | LabTechnician, Pathologist, Doctor, SuperAdmin, Administrator |
| Clinical | Therapy | Doctor, Nurse, SuperAdmin, Administrator |

### In-screen role-gate constants
- `OpdQueueScreen.tsx`: `CAN_OPERATE_QUEUE = ['Doctor','QueueManager','Administrator','SuperAdmin']`, `CAN_CANCEL = ['Reception','QueueManager','Administrator','SuperAdmin']`, `CAN_TRANSFER = ['Reception','Doctor','QueueManager','Administrator','SuperAdmin']`.
- `WardStaffScreen.tsx`: `isDoctorOrAdmin` gates Order Lab/Prescribe/Recommend Therapy/Discharge buttons (others render disabled with a tooltip).
- `PatientRecordsPage.tsx`: only `receptionist`/`admin` (lowercase) get the "Edit profile" link.
- `DoctorSchedulePage.tsx`: `isAdmin = 'Administrator' || 'SuperAdmin'` gates all CRUD controls.

### App-level auth gate (`App.tsx`)
Sequential: not authenticated → `LoginPage`; `mustChangePassword` → `ForcedChangePasswordScreen` (the path a newly created/reset Doctor account is forced through); otherwise → `AppShell`.

Client-side route guarding is **soft** — the Sidebar just doesn't render links a Doctor shouldn't see; deep-linking isn't blocked client-side. Real authorization is enforced server-side by `RbacGuard` (§3).

---

## 11. State Management

No Redux/Zustand — React Context (`AuthProvider` in `hooks/useAuth.ts`) plus local per-screen `useState`.

- `AuthUser`: `{ id, name, email, role, department?, hospitalId?, mustChangePassword? }`. For a Doctor session, `role = 'Doctor'`.
- Persisted to `localStorage` (`esic-hms-auth`) with an 8-hour expiry, checked every 60s.
- Exposes `login`, `logout`, `clearError`, `enterHospital`/`exitHospital` (SuperAdmin only), `clearMustChangePassword`.
- No global "current doctor profile" or "doctor roster" cache — every screen refetches independently (`DoctorWorkspace`'s clinical state, `DoctorSchedulePage`'s `doctors`/form state, etc. are all local).

---

## 12. Frontend API Calls

### `api/doctor.api.ts`
| Function | Endpoint | Used from |
|---|---|---|
| `fetchDoctors()` | `GET /api/doctors` | `DoctorSchedulePage` (non-admin view) |
| `fetchEligibleDoctors(departmentId)` | `GET /api/doctors/eligible` | `OpdQueueScreen` filter, reception doctor picker |
| `fetchAllDoctorsForAdmin()` | `GET /api/doctors/admin` | `DoctorSchedulePage` (admin view) |
| `createDoctor(payload)` | `POST /api/doctors` | "Add Doctor" form |
| `updateDoctor(id, payload)` | `PATCH /api/doctors/:id` | "Save Changes" |
| `setDoctorActive(id, active)` | `PATCH /api/doctors/:id/active` | Deactivate/Reactivate |
| `resetDoctorPassword(id, reason?)` | `POST /api/doctors/:id/reset-password` | Reset Password |
| `setDoctorLocked(id, locked, reason?)` | `PATCH /api/doctors/:id/lock` | Lock/Unlock |
| `resendDoctorActivation(id)` | `POST /api/doctors/:id/resend-activation` | Resend Activation |
| `fetchLeastBusyEligibleDoctor(departmentId)` | `GET /api/doctors/eligible?autoAssign=true` | Auto-assign in reception registration |

### `api/opd.api.ts`
| Function | Endpoint | Trigger |
|---|---|---|
| `fetchMyOpdQueue(token)` | `GET /api/opd-visits/my-queue` | `DoctorWorkspace` polling every 8s |
| `callNextOpdVisit(token)` | `POST /api/opd-visits/call-next` | "Call Next" |
| `callOpdToken(id, token)` | `POST /api/opd-visits/:id/call` | "Call" in `OpdQueueScreen` |
| `startOpdConsultation(id, token)` | `PATCH /api/opd-visits/:id/start-consultation` | "Start Consultation" |
| `completeOpdConsultation(id, token)` | `PATCH /api/opd-visits/:id/complete` | "Complete Consultation" |
| `markOpdNoShow` / `skipOpdVisit` | `PATCH /api/opd-visits/:id/no-show` \| `/skip` | "No-show" / "Skip" |
| `cancelOpdVisit`, `transferOpdVisit`, `closeOpdVisit` | various | `OpdQueueScreen` reassign/cancel |

### `api/prescription.api.ts`
| Function | Endpoint | Trigger |
|---|---|---|
| `createPrescription(payload, token)` | `POST /api/prescriptions` | "Save Draft" in `DoctorWorkspace`; IPD prescription modal |
| `signPrescription(id, token)` | `POST /api/prescriptions/:id/sign` | "Sign & Submit Prescription" |

`CreatePrescriptionPayload`: `{ visitId, symptoms?, examinationNotes?, diagnosisText, followUpFlag?, admissionRecommended?, items: PrescriptionItemPayload[], labTestIds?: string[] }`. `status`: `DRAFT | SIGNED | PARTIALLY_DISPENSED | CLOSED`.

### Other doctor-touching clients
- `api/patient-lookup.api.ts` / `api/patient.api.ts`: `fetchVisitById`, `lookupPatientByUid`, `createPatientVisit`, `searchPatients`.
- `api/benefit.api.ts`: `evaluateBenefitRule` — drives the ESIC coverage badge.
- `api/inventory.api.ts`, `api/lab.api.ts`, `api/catalog.api.ts`, `api/therapy.api.ts`: `fetchMedicines`, `fetchLabTests`, `fetchLabQueue`, `orderLabTests`, `fetchServices({serviceType:'THERAPY'})`, `fetchTherapySessions/Courses`, `openTherapyCourse`, `scheduleTherapySession`.
- `api/dashboard.api.ts`: `fetchDashboardMetrics`, `fetchMyDashboardSummary`.
- `api/security.api.ts`: `fetchBranding` (used for the printed consultation header).
- `api/auth.api.ts`: `changePassword` (forced-change flow), `activateAccount` (activation-email flow).

---

## 13. Every Form a Doctor Fills Out

### A. Consultation & Prescription form (`DoctorWorkspace.tsx`)
- **Patient Symptoms & History** (textarea, optional)
- **Physical Examination Findings** (textarea, optional)
- **Primary Clinical Diagnosis*** (required — blocks Save Draft if empty)
- **Schedule follow-up visit in 7 days** (checkbox)
- **Recommend Admission to IPD Ward** (checkbox, styled red)
- **Prescribed Medicines** — repeatable rows: medicine (stock `<select>` or free-text toggle), dose, frequency, duration (defaults: `1 Tablet`, `1-0-1`, `5 Days`); add/remove buttons
- **Diagnostic Lab Orders** — `<select>` from Lab Test Master → chip list, removable
- **Recommend Therapy** — `<select>` from therapy catalogue; if `unit === 'COURSE'`, a "Planned sessions" number input (1–60)
- Validation: requires diagnosis text + at least one of {a medicine item, a selected lab test, admission recommended}
- Two submits: **Save Draft** vs **Sign & Submit** (irreversible lock)

### B. Visit-ID / Patient lookup mini-forms
- "Visit Context ID": text input + Load button
- "Find an Existing Patient": text input (name/mobile/UHID/EmployeeID) + Find button; ambiguous matches show a clickable list; if no open visit, a department `<select>` + "Start New OPD Visit" button

### C. IPD Prescription form (`WardStaffScreen.tsx`)
Diagnosis/Indication (pre-filled), Symptoms, repeatable medicine rows (same shape as OPD). Two submits: save draft vs sign-and-send-to-pharmacy.

### D. IPD Lab Order form (`WardStaffScreen.tsx`)
Lab test picker + chip list, **Priority** (`ROUTINE` default), **Clinical Notes** (free text).

### E. Discharge form — "Doctor Discharge Handoff" (`WardStaffScreen.tsx`)
**Discharge Summary Notes*** (required textarea). Shows a non-blocking outstanding-balance warning with a shortcut to Patient Ledger.

### F. Log Observation Note (`WardStaffScreen.tsx`, any ward staff)
Single required textarea.

### G. Doctor Schedule / Account forms (`DoctorSchedulePage.tsx`, Admin/SuperAdmin only)
Add/Edit Doctor modal: Name, Email (login identifier), Specialty, Experience, Department `<select>`, Consultation Fee (₹), "Profile verified" checkbox (edit-only), plus the 7-day `WeeklyScheduleEditor` (per-day available checkbox + start/end time pickers).

### H. Password forms
- `ForcedChangePasswordScreen.tsx`: Current (Temporary) Password, New Password, Confirm New Password (min 8 chars, must differ from current), Show-passwords checkbox.
- `ActivateAccountPage.tsx`: New Password, Confirm Password (min 8 chars; token from URL query string).

---

## 14. UI Elements Specific to Doctor Workflow

- **"My OPD Queue" live panel** — current/called patient with token number and quick actions, plus a scrollable strip of waiting patients, auto-refreshed every 8s.
- **OPD token-calling station** — dark "Live Calling Station" hero card per active consultation, waitlist table sorted by `queuePosition`, auto-refreshed every 10s, inline "Reassign" doctor-transfer picker.
- **3-panel split clinical workspace** — explicitly modeled on "Epic EMR-style" layout.
- **Print-only consultation report** — hidden until `window.print()`; hospital letterhead, patient details, exam/diagnosis, medicines table, lab orders table, signature box ("Attending Medical Officer").
- **Draft vs. Signed & Locked state machine** — a `Badge` (NEW CONSULTATION / DRAFT (EDITABLE) / SIGNED & LOCKED) disables every input once a prescription is digitally signed, modeling an immutable, legally-binding record.
- **Stock vs. Custom medicine toggle** per Rx line item (dropdown of real inventory vs. free text).
- **Lab Test Master picker with real backend lab-order status tracking** (REPORTED/CANCELLED/etc.) rather than free-text lab requests.
- **Weekly schedule editor/summary** — renders each doctor's availability as a human-readable string on their profile card.
- **Command palette (Ctrl+K)** — a "Consultations" entry keyworded `doctor, prescription, diagnosis, rx` for fast navigation.

---

## 15. Key File Reference

**Backend** (`apps/api/`):
- `prisma/schema.prisma` — `DoctorProfile` (~line 1397), `User` (~11), `Department` (~250), `OPDVisit` (~279), `Diagnosis`/`Prescription`/`PrescriptionItem` (~317–362), `LabOrder` (~372), `Admission` (~634), `StaffShift` (~690)
- `prisma/seed.ts` — `SYSTEM_ROLES` (~37), `PERMISSION_GRANTS.Doctor` (~98–129), seeded doctor user (~825), 8 demo doctor profiles (~1061–1159)
- `prisma/demo-seed.ts`
- `src/modules/user/doctor.controller.ts`, `doctor.service.ts`, `doctor.service.spec.ts`
- `src/modules/user/dto/create-doctor.dto.ts`, `update-doctor.dto.ts`, `weekly-schedule-entry.dto.ts`, `staff-role.const.ts`
- `src/modules/opd/controllers/opd.controller.ts`, `src/modules/opd/services/opd.service.ts` (+ `.spec.ts`)
- `src/modules/prescription/prescription.controller.ts`, `prescription.service.ts`, `dto/create-prescription.dto.ts`
- `src/modules/admission/admission.controller.ts`, `admission.service.ts`, `dto/allocate-bed.dto.ts`
- `src/modules/dashboard/dashboard.controller.ts`, `dashboard.service.ts`
- `src/modules/patient/patient.service.ts` (doctor scoping)
- `src/modules/laboratory/lab.service.ts`
- `src/modules/auth/auth.service.ts`, `auth.controller.ts`
- `src/common/decorators/permissions.decorator.ts`, `roles.decorator.ts`, `current-user.decorator.ts`
- `src/common/guards/rbac.guard.ts`, `rbac-matrix.spec.ts`, `rbac-role-boundaries.spec.ts`
- `src/common/rendering/pdf-templates.ts` (referring doctor on lab reports)
- `prisma/migrations/20260918185143_doctor_department_fee_schedule/`, `20260918220550_doctor_queue_security_expansion/`

**Frontend** (`apps/web/src/`):
- `pages/doctor/DoctorWorkspace.tsx`
- `pages/DoctorSchedulePage.tsx`
- `screens/opd/OpdQueueScreen.tsx`
- `screens/admission/WardStaffScreen.tsx`
- `screens/laboratory/LabWorkbenchScreen.tsx`, `screens/therapy/TherapyConsoleScreen.tsx`
- `pages/PatientRecordsPage.tsx`, `pages/DashboardPage.tsx`
- `pages/auth/ActivateAccountPage.tsx`, `pages/auth/ForcedChangePasswordScreen.tsx`, `pages/LoginPage.tsx`
- `components/layout/Sidebar.tsx`, `AppShell.tsx`, `TopNav.tsx`, `Breadcrumb.tsx`
- `components/WeeklyScheduleEditor.tsx`, `AccountCreatedModal.tsx`, `ConfirmModal.tsx`
- `hooks/useAuth.ts`
- `api/doctor.api.ts`, `opd.api.ts`, `prescription.api.ts`, `patient-lookup.api.ts`, `benefit.api.ts`, `dashboard.api.ts`, `inventory.api.ts`, `lab.api.ts`, `catalog.api.ts`, `therapy.api.ts`, `security.api.ts`, `auth.api.ts`
- `utils/weeklySchedule.ts`

---

*This document was generated from a full-repo audit of every file referencing the Doctor role/entity across `apps/api` and `apps/web`.*
