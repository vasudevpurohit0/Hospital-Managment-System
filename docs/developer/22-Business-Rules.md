# 22 — Operational Business Rules (VERIFIED — rule + enforcement)

| # | Rule | Code | DB | Frontend | Backend |
|---|---|---|---|---|---|
| R1 | One employee = one immutable Hospital UID; repeats reuse UID, never re-register | `hospital-uid-generator.service`, `employee-verification.service` | `Employee.employeeId @unique`, `HospitalUID 1:1` | universal-search + duplicate redirect | verify/register services |
| R2 | Queue tokens unique per dept/day, reset daily | `opd-token-generator.service`, `queueTokenSequence` (DAILY) | `DocumentSequence` row per `TOKEN:<CODE>`+day | queue display | OPD service |
| R3 | Only Doctor signs prescriptions; SIGNED is immutable | `prescription.service` | `status + signed_at` | DoctorWorkspace sign button (Doctor nav only) | `Prescription:sign` guard |
| R4 | Only Pharmacist dispenses; only via signed Rx; FEFO mandatory | `pharmacy.service.ts:86-94,153-166` | usable-batch query filter | PharmacyWorkspace | `StockTransaction:dispense` guard |
| R5 | Expired stock never dispenses; past-expiry → quarantine (FEFO layer exclusion) | `expiry-scanner.service.ts:27-40` | `stockStatus` transitions | ExpiryManagementScreen | query filter + scanner |
| R6 | One bed = one admission; eligibility + availability both required | `admission.service` allocate | partial-unique `current_admission` | AdmissionDeskScreen eligible-beds | resolve → allocate |
| R7 | Only Doctor approves discharge; summary + bed-free in one transaction | `admission.service` discharge | `DischargeSummary.approved_by` | WardStaffScreen | `Admission:approve` guard |
| R8 | Dynamic pricing; history preserved via snapshot + version id | `PricingService.resolve` + `ChargeService` | `unitRate + servicePriceId` + CHECKs | ServicePricingScreen | single-writer service |
| R9 | No discounts: net = gross always; benefit is reporting-only | `charge.service.ts:30,44-68` (`ZERO`) | `discount=0` CHECKs | ledger shows full amounts | centralized arithmetic |
| R10 | Facility eligibility is data (Post/Grade → category), versioned per admission | `facility.service` resolve | `FacilityEligibilityRule{active,version}` | FacilityRulesScreen | `BenefitRule/Facility` guards |
| R11 | Benefit evaluated fresh at dispense, not locked at prescribing | `benefit-rule.service.evaluate` | outcome recorded per item/charge | Rx shows estimate only | single call site |
| R12 | GRN is the only stock-entry path (full PO→supplier traceability) | `procurement.service` GRN | `GoodsReceiptNote.verified_by` | ProcurementScreen | `MedicineBatch:create` on GRN |
| R13 | Lab: doctors order, technicians collect/enter, Pathologist verifies/releases | `lab.service` status machine | `LabOrder/Item/Result/Report` states | `can()` gates | per-action permission guards |
| R14 | Therapy: doctor/reception order, nurse performs; performed sitting charges | `therapy.service` | `source` + session states | TherapyConsoleScreen | `TherapySession:update` (Nurse) |
| R15 | Every mutation is audit-logged (except auth/health) | `audit.interceptor.ts` | `AuditLog` append-only | — (no UI surfaced; admin reads DB) | global interceptor |
| R16 | Document numbers from one registry (OPD/IPD/LAB/RCPT yearly; tokens daily; samples yearly) | `sequence.definitions.ts` + `document-sequence.service` | `DocumentSequence` unique(name+period) | numbers displayed on slips/reports | central service |
| R17 | Cancelled charges need an actor; PAID charges are never voided in place | `charge.service cancelCharge` | `charge_items_cancellation_is_complete` | cancel button (Admin) | `Charge:cancel` guard |
