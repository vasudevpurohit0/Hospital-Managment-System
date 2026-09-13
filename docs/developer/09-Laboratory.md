# 09 — Laboratory (VERIFIED)

## Flow

```
Doctor orders (LabOrder:create — doctors only, lab staff never order)
  POST /api/lab/orders {visitId, items[]} → LabOrder{LAB/YYYY/NNNNN} + LabOrderItems(ORDERED)
 → Sample collection (LabSample:create — LabTechnician/Pathologist)
  POST /api/lab/orders/:id/collect → LabSample{SYY-NNNNNNN barcode}
 → Result entry (LabResult:create — LabTechnician/Pathologist)
  POST /api/lab/results → LabResult{flag NORMAL|HIGH|LOW|CRITICAL} + items → RESULT_ENTERED
 → Pathologist verification (LabResult:verify — Pathologist ONLY)
  POST /api/lab/orders/:id/verify → VERIFIED
 → Report release (LabReport:read/create/release)
  GET /api/lab/orders/:id/report | /report/pdf (Puppeteer PDF → blob download)
 → Doctor reads report → next clinical step
```

Statuses: order `ORDERED,SAMPLE_COLLECTED,PROCESSING,RESULT_ENTERED,VERIFIED,REPORTED,CANCELLED`;
item `ORDERED,RESULT_ENTERED,VERIFIED`. Catalogue: `LabTest(discipline HAEMATOLOGY…MICROBIOLOGY,
resultType NUMERIC,TEXT,SELECT)` → `LabTestParameter` → `LabReferenceRange(sex MALE,FEMALE,ANY, age band)`,
seeded by `prisma/seeds/lab-catalog.*`.

Files: `laboratory/lab.controller.ts` (prefix `lab`), `lab.service.ts` (+spec).
Frontend: `LabWorkbenchScreen.tsx` (ORDERED→REPORTED board + PDF download via `lab.api.ts:178-193`);
`can()` gates: `lab:collectSample`, `lab:enterResults` (Tech+Path), `lab:verifyReport` (Path only).

## Billing link (VERIFIED)

Lab charges are the ONE case where clinical link + priced service co-occur
(`charge.service.ts:11-16`): a lab `ChargeItem` cites BOTH `labOrderItemId` and `serviceId/servicePriceId`
(the test IS a catalogue service). Constraint `charge_items_lab_requires_service` enforces it.

## Endpoints

`GET /api/lab/tests|/tests/:id`, `GET /api/lab/queue|/orders/:id`,
`POST /api/lab/orders`, `POST /api/lab/orders/:id/collect|/verify`,
`POST /api/lab/results`, `GET /api/lab/orders/:id/report|/report/pdf`
