# 13 — Billing, Ledger & Payments (VERIFIED — financial core)

## Canonical pipeline

```
Billable activity (OPD consult, lab item, therapy sitting, bed-day, pharmacy dispense)
 → Service (catalogue) + effective ServicePrice  — OR — MedicineBatch issue-price (pharmacy only)
 → ChargeItem (PENDING, netAmount = quantity × rate, discount 0, cites servicePriceId)
 → Patient Ledger (aggregation: all PENDING charges per employee)
 → Payment collected → Receipt (RCPT/YYYY/NNNNNN, PaymentMode, collector)
 → Charges → PAID ; Outstanding = PENDING net sum
```

Single writer: `ChargeService` (`src/modules/billing/charge.service.ts:44-68` header comment).
`billing.service.ts` (legacy `BillingTransaction` reads), `charge.controller.ts` (prefix-less absolute paths),
`charge.service.ts`, `receipt.service.ts` (+specs), `dto/`, `amount-in-words.ts`, `excel-export.util.ts`.

## Charge rules (VERIFIED)

- `postServiceCharge()`: resolves price ITSELF via `PricingService` — callers can never invent a rate
  (`charge.service.ts:87-135`). `quantity × configured rate`, no discount, always PENDING regardless of benefit outcome.
- `postServiceChargeIfPriced()`: best-effort skip (logs warn) when unpriced — used for consultation fees so
  unpriced `CONSULT-*` services don't break OPD (lines 137-163).
- `postPharmacyCharge()`: rate from dispensed batch (FEFO-resolved), NOT catalogue (lines 165-210).
- `cancelCharge()`: PENDING-only; PAID requires future reversal workflow, never in-place cancel;
  `actorUserId` REQUIRED by DB check `charge_items_cancellation_is_complete` (lines 212+).
- **No discount exists**: `ZERO` constant; `net = gross`; `benefitOutcome` is reporting-only.
  History: FREE/COVERED used to zero charges via full discount (silently ₹0'd PERMANENT bills) — removed;
  `prisma/seeds/repair-discounted-charges.ts` repairs legacy rows.

## Receipts & ledger (VERIFIED)

- Receipt issuance: `POST /api/receipts` (`Receipt:create` — Reception, AdmissionDesk, Admin).
  Number `RCPT/YYYY/NNNNNN` via `RECEIPT_NUMBER` sequence. PDF via Puppeteer (`GET /api/receipts/:id/pdf`).
- Ledger reads: `GET /api/patients/:employeeId/ledger|/statement/pdf`, `GET /api/visits/:visitId/charges`,
  `GET /api/charges|/summary|/export/excel`, `POST /api/charges/service`, `POST /api/charges/:id/cancel`.
- Legacy: `GET /api/billing/transactions`, `GET /api/billing/receipts/:id` (old `BillingTransaction` path — §24).

## Frontend

`BillingScreen.tsx` (Pharmacy Counter + receipt view + `downloadReceiptPdf`),
`PatientLedgerScreen.tsx` (ledger, statement PDF, `.xls` expense export via `ledger.api.ts:178-220`),
`PatientRecordsPage.tsx` (bills tab).

## Integrity answers (VERIFIED)

- Rates dynamic? YES for services (PricingService); pharmacy uses batch price by design.
- Hardcoded amounts? None found in charge path — `resolve()` throws when unpriced instead.
- Old bills mutable? NO — snapshot (`unitRate` + `servicePriceId`) + CHECK constraints.
- Duplicates? Possible at API level (no idempotency key found — §23/§24); lab/therapy link constraints limit double-post shape.
- Payment without charge? Receipt model allows it (no FK forcing charge linkage traced — confirm in schema before assuming).
- Charge without pricing? Blocked by `resolve()` throw (service) / batch requirement (pharmacy).
