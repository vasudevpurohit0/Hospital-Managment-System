# 17 — API Reference (VERIFIED — from controllers; global prefix `/api`)

Auth: Bearer access JWT unless `@Public()`. Permission = `RequirePermission(resource, action)`; `*` = SuperAdmin bypass.
Public: `GET /health`, `POST /auth/login`, `POST /auth/refresh`, `GET /branding`, `GET /config/branding`.

## Auth & config

| Method & path | Permission | Effect |
|---|---|---|
| `POST /auth/login` | Public | Issues access(8h)+refresh(7d) |
| `POST /auth/refresh` | Public | Re-issues access after active-check |
| `GET /auth/me` | auth | Profile |
| `GET /branding`, `GET /config/branding` | Public | Branding row |
| `PUT /branding` (+alias) | `BrandingConfig:update` | Update + audit |

## Identity, visits, OPD

| Method & path | Permission |
|---|---|
| `POST /employees/verify`, `POST /employees/register`, `POST /employees`, `GET /employees`, `GET /employees/:id`, `PUT /employees/:id` | `Employee:read/create/update` per action |
| `GET /employees/:uid/card` | `HospitalUID:read` |
| `POST /patients/verify-employee`, `POST /patients/register` | `Employee:read/create` |
| `GET /patients/uid/:uid`, `GET /patients/lookup`, `GET /patients/search`, `GET /patients/employee/:employeeId`, `GET /patients/:id/history\|/master` | `Employee:read` / `HospitalUID:read` |
| `POST /patients/visit`, `POST /visits`, `GET /visits/employee/:employeeId`, `GET /visits/:id` | `Visit:create/read` |
| `POST /opd-visits`, `GET /opd-visits/queue`, `POST /opd-visits/:id/call\|/close` | `Employee:read` (+OPDVisit grants) |
| `GET /departments` | `Employee:read` |
| `GET /doctors` | `Doctor:read` ; `POST /doctors` | `Doctor:create` |
| `GET /users` | `Admission:update` (odd coupling — §23) |

## Clinical

| Method & path | Permission |
|---|---|
| `POST /prescriptions`, `PUT /prescriptions/:id` | `Prescription:create/update` |
| `POST /prescriptions/:id/sign` | `Prescription:sign` |
| `GET /prescriptions/visit/:visitId` | `Employee:read` |
| `POST /lab/orders`, `GET /lab/queue`, `GET /lab/orders/:id` | `LabOrder:create/read`, `LabTest:read` |
| `POST /lab/orders/:id/collect` | `LabSample:create` |
| `POST /lab/results` | `LabResult:create` |
| `POST /lab/orders/:id/verify` | `LabResult:verify` |
| `GET /lab/orders/:id/report\|/report/pdf`, `GET /lab/tests\|/tests/:id` | `LabReport:read`, `LabTest:read` |
| `GET /therapy/sessions\|/courses`, `POST /therapy/courses\|/sessions` | `TherapySession:create/read` |
| `POST /therapy/sessions/:id/perform\|cancel\|no-show` | `TherapySession:update` |
| `GET /admissions`, `GET /admissions/:id`, `POST /admissions/:id/resolve\|/allocate\|/notes\|/discharge\|/transfer` | `Admission:create/read/update/transfer/approve`, `AdmissionNote:create` |
| `GET /admissions/:id/eligible-beds\|/location-history\|/financial-summary`, `GET /admissions/wards/all`, `POST /admissions/beds`, `POST /admissions/bed-day-charges/run` | `Admission:read`, `Charge:create/read` |

## Pharmacy / inventory / procurement

| Method & path | Permission |
|---|---|
| `GET /pharmacy/queue`, `GET /pharmacy/prescriptions/:id/batches` | `Prescription:read` |
| `POST /pharmacy/dispense` | `StockTransaction:dispense` |
| `GET /inventory/medicines/template`, `POST /inventory/medicines/import/validate\|confirm\|error-report`, `POST /inventory/medicines` | `Medicine:create` (reads: `MedicineBatch:read`) |
| `GET /inventory/medicines`, `POST /inventory/batches`, `GET /inventory/low-stock\|/stock-locations\|/expiring`, `POST /inventory/scan-expiry\|/batches/:id/quarantine\|dispose` | `MedicineBatch:read/update/create` |
| `POST /procurement/requisitions`, `GET /procurement/requisitions` | requisition `create/read` |
| `POST /procurement/requisitions/:id/approve` | `Approval:approve` |
| `POST /procurement/purchase-orders`, `GET /procurement/purchase-orders` | `PurchaseOrder:create/read` |
| `POST /procurement/goods-receipt-notes` | `MedicineBatch:create` |
| `POST /procurement/transfers`, `GET /procurement/suppliers` | `MedicineBatch:update/read` |

## Money / rules / ops

| Method & path | Permission |
|---|---|
| `GET /billing/transactions`, `GET /billing/receipts/:id` (legacy) | `Billing:read` |
| `GET /patients/:employeeId/ledger\|/statement/pdf`, `GET /visits/:visitId/charges`, `GET /charges\|/summary\|/export/excel`, `POST /charges/service`, `POST /charges/:id/cancel` | `Charge:read/create/cancel` |
| `POST /receipts`, `GET /receipts/:id\|/:id/pdf` | `Receipt:create/read` |
| `GET /catalog/categories\|/services\|/services/unpriced\|/services/:id\|/services/:id/price\|/price-history`, `POST /catalog/services`, `PUT/PATCH /catalog/services/:id`, `POST /catalog/services/:id/prices` | `Service:read/create/update`, `ServicePrice:read/create` |
| `GET /benefit-rules`, `POST /benefit-rules`, `PUT /benefit-rules/:id`, `GET /benefit-rules/evaluate` | `Employee:read`, `BenefitRule:create/update` |
| `GET /facility-rules`, `POST /facility-rules`, `PUT /facility-rules/:id`, `GET /facility-rules/resolve` | `Employee:read`, facility `create/update` |
| `GET /analytics/operations\|/clinical\|/financial\|/inventory` | `Analytics:read` |
| `GET /reports/billing.csv\|/outstanding.csv\|/patient-register.csv` | `Report:generate` |
| `GET /dashboard/summary` | `Employee:read` |
| `GET /rbac/roles`, `GET /rbac/roles/:id/permissions`, `GET /rbac/known-resource-actions`, `POST /rbac/permissions`, `DELETE /rbac/permissions/:id` | `RbacConfig:read/update` |

Error shape: `{statusCode, error, message}` via `AllExceptionsFilter`; DTO failures surface as joined `string[]` on the frontend.
