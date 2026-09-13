# 16 — Analytics, Reports, Dashboard (VERIFIED)

## Analytics (`analytics/`)

`GET /api/analytics/operations|/clinical|/financial|/inventory` — all `Analytics:read` (Admin/SuperAdmin only).
Service: `analytics.service.ts` (+spec). Frontend: `AnalyticsScreen.tsx` (Admin-only nav).
Covers FR-DSH style aggregates (OPD/queue, admissions/occupancy, financial, stock/expiry).
Dashboard freshness target (<5min) is a docs claim — NOT VERIFIED against a cache policy in code.

## Reports (`reports/`)

`GET /api/reports/billing.csv|/outstanding.csv|/patient-register.csv` — all `Report:generate` (Admin only).
`reports.service.ts`, `csv.util.ts`. Frontend: `ReportsScreen.tsx` + `reports.api.ts` (blob CSV download);
`DataTable` adds client-side CSV export; ledger adds `.xls` expense export (`ledger.api.ts:178-220`).

## Dashboard (`dashboard/`)

`GET /api/dashboard/summary` (`Employee:read` — unusually broad read gate for an aggregate endpoint; §23 note).
`dashboard.service.ts` (+spec); e2e `dashboard.e2e-spec.ts`.
Frontend: `DashboardPage.tsx` — role-specific `StatCard`s + `recharts` ward-distribution pie.

## PDF rendering (`common/rendering/`)

`rendering.module.ts`, `document-render.service.ts`, `pdf-templates.ts` — Puppeteer-based.
Consumed by: receipt PDF (`GET /api/receipts/:id/pdf`), statement PDF
(`GET /api/patients/:employeeId/statement/pdf`), lab report PDF (`GET /api/lab/orders/:id/report/pdf`).
Frontend downloads via blob + `a[download]` + `URL.createObjectURL` (`ledger.api.ts:114-143`, `lab.api.ts:178-193`).
No `jspdf/html2canvas/react-to-print` in frontend deps — all PDFs are server-rendered.
Window-print slips/cards/Rx/discharge are CSS-driven (`index.css @media print`), not PDFs.
