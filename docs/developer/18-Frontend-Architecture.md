# 18 — Frontend Architecture (VERIFIED — `apps/web/src`)

## Router: URL-synced PageId (no `<Routes>`)

`main.tsx → App.tsx (BrowserRouter + AuthProvider; LoginPage vs AppShell) → AppShell.tsx`:
`pathForPageId(page) = /<page>` 1:1; `pageIdFromPath()` parses first segment against 24 `KNOWN_PAGE_IDS`;
`/` and unknown paths normalize to landing (`dashboard`, or `opd-queue` for QueueManager, `replace:true`);
QueueManager hard-redirected to `opd-queue`; `renderPage()` switches to the screen component.
Locked by `__tests__/routing.test.ts` (round-trip, `/`, unknown, nested `/billing/RCPT-…`, `//inventory`).

24 PageIds: `dashboard, patient-search, patient-records, registration, opd-queue, consultations,
doctor-schedule, ipd-admissions, ward-console, laboratory, therapy, pharmacy, inventory, expiry-fefo,
supply-chain, billing, patient-ledger, service-pricing, facility-rules, analytics, reports,
rbac-management, system-config` (`Sidebar.tsx`).

## Role → navigation (VERIFIED — `Sidebar.tsx:61-236`)

| Role | Visible pages |
|---|---|
| Reception | dashboard, patient-search, patient-records, registration, opd-queue, doctor-schedule, patient-ledger |
| Doctor | dashboard, patient-search, patient-records, opd-queue, consultations, doctor-schedule, ward-console, laboratory, therapy |
| Nurse | dashboard, patient-search, opd-queue, doctor-schedule, ward-console, therapy |
| Pharmacist | dashboard, patient-search, pharmacy, inventory, expiry-fefo, billing |
| StoreManager | dashboard, inventory, expiry-fefo, supply-chain |
| ProcurementOfficer | dashboard only (backend grants exist without nav — §05) |
| AdmissionDesk | dashboard, ipd-admissions, patient-ledger |
| LabTechnician/Pathologist | laboratory (via direct URL; not in dashboard roles) |
| QueueManager | opd-queue only |
| DataEntryOperator | dashboard only |
| Administrator/SuperAdmin | all 24 |

## API layer

`api/client.ts` (`getStoredToken` + expiry check, `apiFetch` with Bearer, JSON auto-header except FormData,
401 → purge storage) ; `api/http.ts` (`ApiError{status,body}`, `extractErrorMessage`, non-JSON/204 handling) ;
24 domain modules (`admission|analytics|benefit|billing|catalog|dashboard|doctor|employee|facility|
inventory|lab|ledger|opd|patient|patient-lookup|pharmacy|prescription|procurement|rbacAdmin|reports|
security|therapy|user.api.ts`) — all take `token?`, `unwrap(res, fallback)`.
Dev proxy: `vite.config.ts` `/api → VITE_API_PROXY_TARGET || 127.0.0.1:3000` (+503 JSON fallback);
`useAuth.ts` posts to `VITE_API_URL || http://localhost:3000/api/auth/login` with relative fallback.

## State, forms, UX

- No Redux/Zustand/React-Query: sole global store `AuthContext` (`useAuth.ts`: `token,user,isAuthenticated,
  isLoading,error,login,logout`); per-screen `useState/useEffect/useCallback/useMemo`; props drill
  `authToken/userRole/onNavigate`; persistence `esic-hms-auth` + `esic-theme`; no server cache
  (fetch-on-mount per screen).
- Forms: native inputs + `required` + manual guards (no RHF/zod — docs claim them, NOT VERIFIED);
  backend messages surfaced via `extractErrorMessage`.
- Print: `window.print()` + `index.css:762-994 @media print` (thermal slip 85mm, pass 100mm, A4 consult,
  UID card `#printable-uid-card`, Rx, label, discharge, receipt; hides nav/buttons).
- PDF: server-rendered only (no client PDF lib): receipt/statement/lab-report blob downloads.
- CSV/XLS: `DataTable` client export + report CSVs + ledger `.xls`.
- Camera: `EnterpriseReceptionDesk` `getUserMedia({facingMode:user, 640×480})` → canvas JPEG 0.9 → payload + slip photo; file-upload fallback.
- Search: `CommandPaletteOverlay` (Ctrl+K, 20 `SEARCHABLE_PAGES`, QueueManager-filtered) + `TopNav` trigger +
  `DataTable` client filter/sort/paginate(10) + domain lookups (UID, patient search, queue filter).

## UI EXISTS BUT BACKEND GAP / vice versa (VERIFIED)

- `PatientWorkspace.tsx` not rendered (dead screen).
- ProcurementOfficer/DataEntryOperator/Lab roles: backend grants exceed sidebar surfaces (IMPLEMENTED BUT NO UI).
- `DoctorSchedulePage` create form + `TopNav` notifications (empty) + `system-config` screen: verify backing endpoints before relying on them.
