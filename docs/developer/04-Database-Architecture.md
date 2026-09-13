# 04 — Database Architecture (VERIFIED against `prisma/schema.prisma`, 1495 lines)

Datasource: `postgresql`, `url = env("DATABASE_URL")`, `binaryTargets native + rhel-openssl-1/3`.
Migrations: `prisma/migrations/` — `20260729054230_init` then 9 feature migrations
(document sequences, service pricing master, charge ledger + receipts, charge column rename,
therapy source, laboratory, therapy, IPD location tracking, OPD/IPD numbers).

Conventions: UUID PKs (`@db.Uuid`, `@default(uuid())`), snake_case columns via `@map`,
`@@map` table names, `createdAt/updatedAt` audit pair on most models, `@@unique[roleId,resource,action]`
on Permission, `@@index[employmentTypeId, active]` on BenefitRule.
No soft-delete column was found — deletion, where allowed, is hard delete (wards/beds) or
status transition (charges CANCELLED, receipts CANCELLED, therapy CANCELLED).

## Identity & access (7)

| Model | Purpose / keys / relations |
|---|---|
| `User` | Login account. `identifier @unique`, `passwordHash`, `roleId → Role`, `employeeId @unique? → Employee`. Relations to admissions (doctor/nurse), approvals, auditLogs, charges (created/cancelled), receipts, lab artefacts, therapy, GRN/PO/requisitions, stockTx, transfers. |
| `Role` | `name @unique` (string, NOT enum), `isSystemRole`. 13 seeded. `1—* Permission`, `1—* User`. |
| `Permission` | `{roleId, resource, action}`, `@@unique[roleId,resource,action]`, `onDelete: Cascade`. |
| `EmploymentType` | `code: EmploymentTypeCode(PERMANENT, CONTRACTUAL) @unique`. Drives benefit rules. |
| `Post` / `Grade` | `Post.title @unique`; `Grade.payLevel + postId?`. Both referenced by `Employee` and `FacilityEligibilityRule`. |
| `DoctorProfile` | Extends a `User` with `specialty/experience/timing/available`. |

## Patient identity (5)

| Model | Purpose / keys / relations |
|---|---|
| `Employee` | Labour-Dept identity. `employeeId @unique` (official ID), `postId/gradeId/employmentTypeId` FKs, contact fields nullable. `1—1 HospitalUID`, `1—1 PatientProfile`, `1—1 User?`, `1—* Receipt`. WHO CREATES: Reception/DataEntryOperator (`Employee:create`). |
| `HospitalUID` | Permanent card. `uid_code @unique immutable`, `employee 1:1`, `qr_payload`. READ: Reception/Doctor/AdmissionDesk/Nurse/Pharmacist flows. |
| `PatientProfile` | Clinical extension `employee 1:1` (`eligibility_category`). |
| `ManualVerificationCase` | Graceful-degrade queue when Labour verification fails (NOT traced to a controller in this audit — see §24). |
| `Visit` | Episode. `employee → VisitType(OPD,IPD)`, `VisitStatus(OPEN,CLOSED)`. Parent of OPDVisit/Diagnosis/Prescription/LabOrder/TherapyCourse/Admission/ChargeItem. |

## OPD & consultation (4)

`Department` (data-driven departments) → `OPDVisit` (`visit 1:1`, `department`, daily `token_number` unique per dept/day via `DocumentSequence TOKEN:<CODE>`, `called_at`, yearly `OPD_NUMBER`) → `Diagnosis` (visit, doctor, symptoms/notes/follow_up/`admission_recommended`) → `Prescription` (`DRAFT,SIGNED,PARTIALLY_DISPENSED,CLOSED`, `signed_at`) → `PrescriptionItem` (`medicine/dose/frequency/duration`, `benefit_outcome`, `PENDING,DISPENSED,PARTIALLY_DISPENSED`).

## Laboratory (7)

`LabTest` (catalogue: discipline `HAEMATOLOGY…MICROBIOLOGY`, `LabResultType`) → `LabTestParameter` → `LabReferenceRange` (sex/age-banded) ; `LabOrder` (visit, yearly `LAB_NUMBER`, `LabOrderPriority ROUTINE,URGENT,STAT`, `LabOrderStatus ORDERED…REPORTED,CANCELLED`) → `LabOrderItem` (`ORDERED,RESULT_ENTERED,VERIFIED`) → `LabSample` (barcoded `SYY-NNNNNNN` via `SAMPLE_CODE`) → `LabResult` (flag `NORMAL,HIGH,LOW,CRITICAL`) → `LabReport` (verified by Pathologist).

## Therapy (2)

`TherapyCourse` (`IN_PROGRESS,COMPLETED,CANCELLED`, `TherapySource DIRECT,OPD,IPD` — see migration `20260829230210`) → `TherapySession` (`SCHEDULED,PERFORMED,CANCELLED,NO_SHOW`). Performed session posts a service charge (`therapySessionId`).

## IPD / ward (8)

`FacilityEligibilityRule` (post/grade → `FacilityCategory A,B,C,D,CONTRACTUAL`, ward/room/level, `active`, `version`) ; `Ward(category)` → `Room(ward, RoomType SINGLE,SHARED,GENERAL)` → `Bed(room, BedStatus AVAILABLE,OCCUPIED,MAINTENANCE, current_admission unique-when-non-null)` ; `Admission` (visit, 7-state `REQUESTED…DISCHARGED`, `eligible_category`, bed, doctor/nurse, yearly `IPD_NUMBER`) → `AdmissionNote`, `PatientLocationHistory` (migration `20260830120000`), `DischargeSummary` (`admission 1:1`, `approved_by Doctor`).

## Money (8)

`ServiceCategory` → `Service` (`ServiceType CONSULTATION,TEST,THERAPY,PROCEDURE,PACKAGE,BED_DAY,CARE_PER_DAY`; `ServiceApplicability OPD,IPD,BOTH`; `ServiceUnit`; `active`) → `ServicePackageItem` (package components) → `ServicePrice` (`serviceId, amount, effectiveFrom, effectiveTo?` — the versioned rate; `createdBy`) → `ChargeItem` (universal ledger: visit + optional admissionId/serviceId/`servicePriceId`/prescriptionItemId/medicineBatchId/labOrderItemId/therapySessionId, `quantity/unitRate/gross/discount(0)/net`, `benefitOutcome`, `ChargeStatus PENDING,PAID,CANCELLED`, createdBy/cancelledBy + CHECK constraints incl. `charge_items_cancellation_is_complete`) → `Receipt` (yearly `RCPT/…`, `PaymentMode CASH,UPI,CARD,NOT_APPLICABLE`, `ReceiptStatus ISSUED,CANCELLED`, collector, applies to charges) ; `BillingTransaction` (legacy per-item rows — superseded by ChargeItem, still present); `DocumentSequence` (all counters).

Historical-price preservation (VERIFIED): `PricingService.resolve()` picks the row covering `at` (`effectiveFrom <= at AND (effectiveTo NULL OR > at)`, latest first) and `ChargeService` stores both `unitRate` snapshot AND `servicePriceId` — later price edits cannot rewrite old bills. Pharmacy variant stores the batch `issue_price` snapshot instead of a catalogue price.

## Inventory & supply chain (11)

`Supplier` → `Medicine` (generic/brand/category/strength/form master) → `MedicineBatch` (batch#, mfg/expiry indexed, purchase/issue price, `stockStatus` 6-state, location) → `PharmacyStock` (batch × `PharmacyLocation CENTRAL_STORE,PHARMACY` qty) → `StockTransaction` (append-only `DISPENSE,RECEIPT,TRANSFER,DISPOSAL`, signed qty, prescription_item link, performer) ; `PurchaseRequisition` (raised_by StoreMgr, `PENDING,APPROVED,REJECTED,FULFILLED`) → `RequisitionItem` → `Approval` (`APPROVED,REJECTED`) → `PurchaseOrder` (requires Approved requisition, `ISSUED,DISPATCHED,RECEIVED,CLOSED`) → `POItem` → `GoodsReceiptNote` (verified_by; ONLY creator of batches) → `GRNItem` → `StoreTransfer` (central ↔ pharmacy).

## Governance & misc (5)

`BenefitRule` (employmentType + nullable medicineCategory → `BenefitOutcome FREE,COVERED,PAID`, `active`, `version`) ; `AuditLog` (actor + denormalized role, action, entity/id, before/after JSON, indexed `created_at`, append-only) ; `BrandingConfig` (single row) ; `BillingType(GENERAL,ESIC_BENEFICIARY)` (visit billing class).

## ER sketch (prose)

```
Role ─1:* Permission ; Role ─1:* User ─1:1? Employee ─1:1 HospitalUID / PatientProfile
Employee ─1:* Visit ─1:1 OPDVisit ; Visit ─1:* Diagnosis / Prescription ─1:* PrescriptionItem
Visit ─1:* LabOrder ─1:* LabOrderItem ; LabOrder ─1:* LabSample ; LabTest ─1:* Parameter ─1:* ReferenceRange
Visit ─1:* TherapyCourse ─1:* TherapySession ; Visit ─1:* Admission ─1:1 Bed (via current_admission)
Ward ─1:* Room ─1:* Bed ; Admission ─1:* AdmissionNote / LocationHistory ─1:1 DischargeSummary
ServiceCategory ─1:* Service ─1:* ServicePrice ─1:* ChargeItem ─*:1 Receipt
Medicine ─1:* MedicineBatch ─1:* PharmacyStock / StockTransaction
Requisition ─1:* Items ─1:1 Approval ─1:1 PO ─1:* POItems ─1:1 GRN ─1:* GRNItems ─* Batch
```

Per-entity RBAC/creator/reader detail lives in §05 and §§07–15.
