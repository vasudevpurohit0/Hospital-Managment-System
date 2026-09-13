# 15 — Inventory & Procurement (VERIFIED)

## Inventory (`inventory/`)

`Medicine` master (generic/brand/category/strength/form) → `MedicineBatch{batch#, mfg/expiry indexed,
purchase/issue price, current/min/reorder, location, stockStatus 6-state}` →
`PharmacyStock{batch × CENTRAL_STORE|PHARMACY}` → `StockTransaction{DISPENSE|RECEIPT|TRANSFER|DISPOSAL,
signed qty, prescription link, performer}` (append-only).

Key logic (VERIFIED):
- FEFO availability: `inventory.service.ts:31,184` (`orderBy expiryDate asc`); usable excludes
  `EXPIRED,QUARANTINED,DISPOSED`.
- Expiry scanner (`services/expiry-scanner.service.ts`, scheduled via `ScheduleModule`):
  past-expiry → `QUARANTINED` (immediately excluded from FEFO), warn ≤90d / critical ≤30d surfacing;
  disposal human-approved + audited, never automatic (`POST …/quarantine|/dispose`, `MedicineBatch:update`).
  E2E: `test/expiry.e2e-spec.ts`.
- Excel import: `GET /medicines/template`, `POST /medicines/import/validate|confirm|error-report`
  + `excel/` utils; `FormData` upload (frontend skips JSON header for FormData — `client.ts:30`).
  Validation gaps noted in §23.
- Reads: `GET /medicines|/low-stock|/stock-locations|/expiring`, `POST /medicines|/batches|/scan-expiry`.

Frontend: `InventoryScreen.tsx` (master + import), `ExpiryManagementScreen.tsx`.

## Procurement (`procurement/`)

```
Low-stock alert → POST /api/procurement/requisitions (StoreManager create)
 → POST /api/procurement/requisitions/:id/approve (Approval:approve — ProcurementOfficer/Admin)
 → POST /api/procurement/purchase-orders (PurchaseOrder create — gate: requisition must be Approved)
 → Supplier dispatch → POST /api/procurement/goods-receipt-notes (MedicineBatch:create — verified GRN)
    → GRN is the ONLY stock-entry path → MedicineBatch rows created with PO→supplier traceability
 → POST /api/procurement/transfers (MedicineBatch:update — central ↔ pharmacy)
```

Reads: `GET /requisitions|/purchase-orders|/suppliers`. E2E: `procurement.e2e-spec.ts`.
Frontend: `ProcurementScreen.tsx` (`supply-chain` PageId; StoreManager/SuperAdmin/Admin visible —
ProcurementOfficer has backend grants but (almost) no nav: §05 mismatch).

## Files

`inventory/inventory.controller|service|module (+spec)`, `dto/`, `excel/`, `services/expiry-scanner.service(+spec)`;
`procurement/procurement.controller|service|module (+spec)`, `dto/ ×5`.
