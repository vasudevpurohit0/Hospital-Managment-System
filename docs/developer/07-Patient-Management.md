# 07 — Patient Management: Employee → UID → Profile → Visit (VERIFIED)

## Identity chain

```
Labour-Department Employee ID (official, external)
 → POST /api/employees/verify (Employee:read) — verification service
 → POST /api/employees/register | POST /api/patients/register (Employee:create)
     → Employee row (employeeId @unique) + HospitalUID (uid_code immutable + qr_payload) + PatientProfile
 → GET /api/employees/:uid/card (HospitalUID:read) → UidCard (QR + print CSS)
 → GET /api/patients/lookup?uid=… | /api/patients/search | /api/patients/uid/:uid
 → POST /api/visits | POST /api/patients/visit (Visit:create) → Visit{OPD|IPD, OPEN}
 → GET /api/patients/:id/history | /:id/master (longitudinal record)
```

Controllers: `employee.controller.ts` (`employees`), `patient.controller.ts` + `patient-lookup.controller.ts`
(both prefix `patients` — note the split: general patient ops vs lookup in `visit/` module).
Services: `employee/services/*` (incl. `hospital-uid-generator`, `qr-code`, `employee-verification` + specs),
`patient.service.ts`, `visit.service.ts`, `patient-lookup.service.ts`.

## UID & QR (VERIFIED)

- One employee = one `HospitalUID` (DB `1:1`; duplicate registration redirects to lookup — business rule §22).
- `uid_code` immutable; lost card = reprint (`GET card` again), never re-register.
- QR payload rendered by `qrcode@1.5.4` server-side; displayed in `UidCard.tsx` (`qrDataUrl`, `#printable-uid-card`).
- `ManualVerificationCase` model exists for Labour-API-down fallback (docs claim graceful degrade);
  NO controller for it was found in the controller inventory → likely IMPLEMENTED BUT NO UI / dead path (see §24).

## Frontend

`EnterpriseReceptionDesk.tsx` (~2000 lines): workflows `dashboard | esic-beneficiary | universal-search | success-slip`;
OPD/IPD/THERAPY intent selection; live queue; photo capture (`getUserMedia → canvas.toDataURL jpeg 0.9`) + file-upload
fallback; slip/pass print (`85mm`/`100mm`/A4 CSS). `PatientRecordsPage.tsx`: master + visits/admissions/bills + statement PDF.
`PatientWorkspace.tsx`: legacy/alt workspace — NOT in `renderPage` (dead screen, §24).

## Endpoints (prefix `/api`)

- `POST /employees/verify`, `POST /employees/register`, `POST /employees`, `GET /employees`,
  `GET /employees/:id`, `PUT /employees/:id`, `GET /employees/:uid/card`
- `POST /patients/verify-employee`, `POST /patients/register`, `GET /patients/uid/:uid`,
  `GET /patients/employee/:employeeId`, `GET /patients/search`, `POST /patients/visit`,
  `GET /patients/:id/history|/master`, `PUT /patients/:id`, `GET /patients/lookup`
- `POST /visits`, `GET /visits/employee/:employeeId`, `GET /visits/:id`
