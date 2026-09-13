# 10 — Pharmacy (VERIFIED)

## Flow

```
Signed prescription appears in queue
  GET /api/pharmacy/queue (Prescription:read) → PharmacyWorkspace
 → Per-item live batch availability
  GET /api/pharmacy/prescriptions/:id/batches → FEFO-ordered usable batches
 → Dispense (Pharmacist ONLY — StockTransaction:dispense)
  POST /api/pharmacy/dispense {items}
   → for each item: pick earliest-expiry usable batch (FEFO), benefit evaluate,
      deduct stock, append StockTransaction, post pharmacy charge (batch issue-price),
      update PrescriptionItem → DISPENSED / PARTIALLY_DISPENSED
   → Prescription → CLOSED / PARTIALLY_DISPENSED (+ procurement alert on shortfall)
```

Files: `pharmacy/pharmacy.controller.ts` (prefix `pharmacy`), `pharmacy.service.ts` (+spec).
Key code: batches query `notIn [EXPIRED,QUARANTINED,DISPOSED]`, `orderBy expiryDate asc`
(`pharmacy.service.ts:86-94`); re-check at dispense lines 153-166.

## FEFO + expiry (VERIFIED)

- Usable = status NOT IN expired/quarantined/disposed AND earliest `expiryDate` first.
- Expired batches are structurally excluded at the query layer (not just UI).
- `expiry-scanner.service.ts` transitions past-expiry → QUARANTINED (nurse-scheduled job);
  disposal is human-approved + audited, never automatic.

## Benefit at dispense (VERIFIED)

Single call site `BenefitRuleService.evaluate(type, medicine)`; seed maps Contractual → PAID.
Outcome is recorded on the charge for reporting but NEVER changes the amount
(`charge.service.ts:61-68` — historical zeroing bug documented in code comments).

## Frontend

`PharmacyWorkspace.tsx` (dispense queue + label `window.print()`); `BillingScreen.tsx`
(Pharmacy Counter receipt view + `downloadReceiptPdf`).

## Endpoints

`GET /api/pharmacy/queue`, `GET /api/pharmacy/prescriptions/:id/batches`, `POST /api/pharmacy/dispense`
