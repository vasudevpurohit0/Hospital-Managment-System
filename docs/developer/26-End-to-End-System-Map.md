# 26 — End-to-End System Map (VERIFIED)

## Patient → care

```
PATIENT (Employee + HospitalUID + QR)
 ↓ REGISTRATION (verify → register → card)
 ↓ OPD (dept + TOKEN:<CODE>-NNN + OPD/YYYY/NNNNNN)
 ↓ CONSULTATION (Diagnosis + signed Prescription)
 ├── LAB (Order LAB/YYYY/NNNNN → Sample SYY-NNNNNNN → Result → Pathologist verify → REPORT → Doctor)
 ├── PHARMACY (signed queue → FEFO dispense → stock decrement → StockTransaction)
 ├── THERAPY (course [DIRECT|OPD|IPD] → sessions → Nurse perform → per-sitting charge)
 └── IPD (REQUESTED → resolve → ALLOCATED bed → ward notes/transfers → Doctor discharge → summary)
```

## Money (all billable activities converge)

```
SERVICE PRICING (catalogue + effective-dated versions)   [pharmacy: batch issue-price instead]
 ↓ CHARGE (ChargeItem PENDING, qty × rate, discount 0, cites servicePriceId)
 ↓ PATIENT LEDGER (per-employee aggregation)
 ↓ PAYMENT (Receipt RCPT/YYYY/NNNNNN, CASH|UPI|CARD)
 ↓ RECEIPT PDF (Puppeteer) → charges PAID
```

## Supply chain

```
INVENTORY (Medicine → Batch → PharmacyStock, FEFO-ordered, expiry-scanned)
 ↓ REQUISITION (StoreManager) ↓ APPROVAL (ProcurementOfficer/Admin)
 ↓ PO (gated on Approved) ↓ Supplier ↓ GRN (ONLY batch creator, verified)
 ↓ BATCH/STOCK ↓ transfer ↓ PHARMACY ↓ DISPENSING (→ StockTransaction + charge)
```

Each arrow resolves to a controller → service → model in §§07–15 and paths in §17.
Unmapped integrations (gateway, devices, S3, BullMQ, Sentry) are NOT VERIFIED present.

## One-page visual (same facts as above, Mermaid)

Added for onboarding/management — this is a rendering of the exact same verified
flow above (Patient → Care, Money, Supply chain), not a new source of truth.
Role tags are per `PERMISSION_GRANTS` in `apps/api/prisma/seed.ts`. Ward tier is
deliberately left generic ("Bed / Ward Allocation") rather than naming a specific
room class — pricing/eligibility detail lives in `FacilityEligibilityRule`, not here.

```mermaid
flowchart TD
    A["Patient Entry"] --> B["Search / Registration<br/><i>Reception</i>"]
    B --> C1["OPD<br/><i>Reception, Queue Manager, Doctor</i>"]
    B --> C2["Direct Therapy<br/><i>Reception</i>"]
    B --> C3["IPD Admission<br/><i>Admission Desk, Nurse</i>"]
    C1 --> D["Clinical / Service Care"]
    C2 --> D
    C3 --> D
    D --> E1["Laboratory<br/><i>Doctor orders · Lab Tech · Pathologist</i>"]
    D --> E2["Pharmacy<br/><i>Pharmacist</i>"]
    D --> E3["Therapy Service<br/><i>Nurse</i>"]
    SC["Supply Chain: Medicine Master → Stock/Batch → Expiry(FEFO)<br/>⇄ Requisition → Approval → PO → GRN<br/><i>Store Manager, Procurement Officer</i>"] -.-> E2
    E1 --> F["Unified Patient Data"]
    E2 --> F
    E3 --> F
    F --> G["Service Pricing (versioned) → Charge Creation<br/><i>Administrator · no discounts, net = gross</i>"]
    G --> H["Patient Ledger"]
    H --> I["Payment Collection → Receipt (PDF)"]
    I --> J["Discharge / Visit Completion<br/><i>Doctor approves, IPD only</i>"]
    J --> K["Patient History & Reports"]
    K --> L["Analytics & Administration<br/><i>Administrator, Super Admin</i>"]

    classDef entry fill:#dbe9fb,stroke:#0B2545;
    classDef clinical fill:#dcf0e8,stroke:#0B2545;
    classDef money fill:#fdf0d5,stroke:#0B2545;
    classDef admin fill:#e8e3f5,stroke:#0B2545;
    class A,B,C1,C2,C3 entry;
    class D,E1,E2,E3 clinical;
    class F,G,H,I money;
    class J,K,L admin;
```
