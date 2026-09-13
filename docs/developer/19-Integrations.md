# 19 — Integration Map (VERIFIED arrows)

## Registration → care → money

```
Employee verify/register (Employee:*) → HospitalUID (qr_payload) → PatientProfile
 → Visit{OPD} → OPDVisit{TOKEN + OPD_NUMBER} → Diagnosis → Prescription --sign--> Pharmacy queue
 → FEFO dispense (StockTransaction + PharmacyStock decrement)
 → ChargeItem (service-price snapshot OR batch price) → Ledger → Receipt → PAID
```

## Consultation branches

```
Doctor ──LabOrder──> Sample collect ──> Result entry ──Pathologist verify──> Report ──> Doctor
Doctor ──Therapy order──> Nurse perform──> Session PERFORMED ──> Charge ──> Ledger
Doctor ──admission_recommended──> Admission REQUESTED ──resolve──> ALLOCATED ──ward care──> Doctor discharge
```

## Supply chain

```
Store ──low-stock──> Requisition ──Approval(approve)──> PO ──Supplier──> GRN (ONLY batch creator)
 ──> MedicineBatch/PharmacyStock ──transfer──> Pharmacy ──dispense──> StockTransaction
```

## What is NOT an integration (VERIFIED absent)

- Labour Dept API: adapter path referenced in docs (`employee/adapters/labour-dept.client.ts` was reported
  present — treat as the seam; `ManualVerificationCase` fallback has no controller → degrade path is partial).
- Payment gateway: none (ledger + receipt only).
- Lab devices: none (manual entry).
- Object storage (S3/MinIO), BullMQ, Sentry, Prometheus: referenced in docs; no executing integration found
  (Redis client + ScheduleModule exist; queue usage beyond counters NOT VERIFIED).
- Every arrow above was traced to a controller → service → model in §§07–15; anything else is NOT VERIFIED.
