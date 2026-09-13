# 12 — IPD & Ward (VERIFIED)

## Admission state machine

`REQUESTED → ELIGIBILITY_CHECKED → AWAITING_BED / ALLOCATED → UNDER_TREATMENT → DISCHARGE_APPROVED → DISCHARGED`
(`AdmissionStatus` enum; transitions in `admission.service.ts`).

## Flow

```
Doctor flags admission_recommended (Diagnosis) → Admission REQUESTED (Admission:create)
 → POST /api/admissions/:id/resolve → facility-rule engine → eligible_category + version recorded
 → GET /api/admissions/:id/eligible-beds → availability-filtered beds (category + AVAILABLE)
 → POST /api/admissions/:id/allocate {bedId} → bed lock + ALLOCATED (concurrency-guarded;
    e2e: test/admission-concurrency.e2e-spec.ts; DB partial-unique on current_admission)
 → Ward care: POST /api/admissions/:id/notes (AdmissionNote:create — Nurse),
    transfers POST /api/admissions/:id/transfer (Admission:transfer — AdmissionDesk/Nurse),
    location history (PatientLocationHistory, migration 20260830120000)
 → Bed-day billing: POST /api/admissions/bed-day-charges/run (Charge:create) → ChargeItems
 → Discharge: POST /api/admissions/:id/discharge (Admission:approve — DOCTOR ONLY)
    → DischargeSummary{approved_by} + bed freed in same transaction
 → Financial settlement: GET /api/admissions/:id/financial-summary (Charge:read)
```

Files: `admission/admission.controller.ts` + `ipd-finance.controller.ts` (both prefix `admissions`),
`admission.service.ts`, `ipd-finance.service.ts` (+spec), `dto/`.
Frontend: `AdmissionDeskScreen.tsx` (beds, allocate, transfer), `WardStaffScreen.tsx`
(beds, Rx, discharge, `window.print()` discharge summary).

## Bed model (VERIFIED)

`Ward(category A,B,C,D,CONTRACTUAL)` → `Room(ward, SINGLE,SHARED,GENERAL)` → `Bed(AVAILABLE,OCCUPIED,MAINTENANCE)`.
Eligibility AND availability are both required (docs §17 non-negotiable — enforced: resolve then allocate).
`GET /api/admissions/wards/all`, `POST /api/admissions/beds`, `DELETE /api/admissions/wards/:id|/beds/:id` (hard delete — §23 note).

## Endpoints

`GET /api/admissions`, `GET /api/admissions/:id`, `POST /api/admissions/:id/resolve|/allocate|/notes|/discharge|/transfer`,
`GET /api/admissions/:id/eligible-beds|/location-history|/financial-summary`,
`GET /api/admissions/wards/all`, `POST /api/admissions/beds`, `POST /api/admissions/bed-day-charges/run`
