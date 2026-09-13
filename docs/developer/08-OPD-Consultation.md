# 08 — OPD & Consultation (VERIFIED)

## OPD flow

```
START: registered employee + HospitalUID
 → Reception: EnterpriseReceptionDesk → POST /api/opd-visits (Employee:read gate)
    → OPDVisit{department, TOKEN:<CODE>-NNN (DocumentSequence DAILY), OPD/YYYY/NNNNNN (YEARLY)}
 → Queue: GET /api/opd-visits/queue → OpdQueueScreen (call display)
 → POST /api/opd-visits/:id/call → doctor sees patient (DoctorWorkspace)
 → Doctor: diagnosis (Diagnosis create) + prescription draft + lab/therapy orders
 → POST /api/prescriptions/:id/sign (Prescription:sign, Doctor only) → locks Rx, publishes to pharmacy
 → Pharmacy dispense (§10) → billing charges (§13)
 → POST /api/opd-visits/:id/close → Visit CLOSED
```

Files: `opd/controllers/opd.controller.ts` (`opd-visits`), `opd/controllers/department.controller.ts`
(`departments`), `opd/services/*` (department, opd, `token-generator` + spec), `prescription/*`,
`visit/*`. Frontend: `OpdQueueScreen.tsx`, `DoctorWorkspace.tsx` (visit lookup, Rx builder, `window.print()` Rx),
`DoctorSchedulePage.tsx` (static list + create form).

## Token generation (VERIFIED)

- `queueTokenSequence(deptCode)` (`sequence.definitions.ts`): `TOKEN:<CODE>`, `DAILY` reset, 3-digit pad → `CARDIO-014`.
- Counters live in `DocumentSequence` (name + period key unique) — concurrency-safe via DB row (`document-sequence.service.ts` + spec).
- Yearly `OPD_NUMBER`: `OPD/YYYY/NNNNNN` (6-pad). IPD/LAB/RCPT/SAMPLE equivalents in same registry.

## Prescription rules (VERIFIED)

- `DRAFT` editable by author; `SIGNED` immutable; then `PARTIALLY_DISPENSED`/`CLOSED` via pharmacy.
- Only `Prescription:sign` holders (Doctor + Admin/SuperAdmin) can sign — enforced backend.
- `PrescriptionItem.benefit_outcome` recorded at order; authoritative evaluation happens at dispense (`BenefitRuleService.evaluate`).

## Endpoints

- `POST /api/opd-visits`, `GET /api/opd-visits/queue`, `POST /api/opd-visits/:id/call|/close`
- `GET /api/departments`
- `POST /api/prescriptions`, `PUT /api/prescriptions/:id`, `POST /api/prescriptions/:id/sign`, `GET /api/prescriptions/visit/:visitId`
