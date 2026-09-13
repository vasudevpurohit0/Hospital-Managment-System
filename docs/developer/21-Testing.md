# 21 — Testing (VERIFIED)

## Frameworks

- Backend unit: Jest 29.7 (`rootDir src`, `testRegex .*\.spec\.ts$`, `@/*→src/*`) — **30 spec files**.
- Backend e2e: Jest + Supertest (`test/jest-e2e.json`, `*.e2e-spec.ts`) — **15 files**.
- Frontend: Vitest 2.1.8 + jsdom + Testing Library (`routing`, `permissions`, `App` tests).
- Lint: eslint 8.57 + @typescript-eslint 8.19 (`lint`, `lint:fix`). Typecheck: `tsc --noEmit`.
- Turbo: `test` outputs `coverage/**`, inputs `src/**+test/**`; `test:e2e` uncached.

## Coverage by area (VERIFIED file list)

- Unit: health, `rbac.guard`, `rbac-matrix` (imports `PERMISSION_GRANTS` — seed/guard conformance),
  security middleware, document-sequence, auth, visit, patient-lookup, patient, facility, benefit-rule,
  prescription, pharmacy (FEFO order test), inventory, expiry-scanner, procurement, billing, charge,
  receipt, pricing, lab, therapy, analytics, dashboard, ipd-finance, qr-code, hospital-uid-generator,
  employee-verification, opd-token-generator.
- E2E: admission-concurrency, benefit-rule, billing, dashboard, expiry, health, inventory,
  opd-concurrency, pharmacy, prescription, procurement, rbac, registration-concurrency, security, visit.

## How to run

```
pnpm lint ; pnpm typecheck
pnpm --filter @esic-hms/api test            # unit
pnpm --filter @esic-hms/api test:e2e        # needs DATABASE_URL + REDIS_URL (CI uses _test DB)
pnpm --filter @esic-hms/api test:cov
pnpm --filter @esic-hms/web test            # vitest run
pnpm build                                  # turbo build
pnpm test:e2e                               # turbo e2e
```

## CI (VERIFIED — `.github/workflows/ci.yml`)

Push to `main` + PRs: pnpm 9.15.4 + Node 20, services pg15 (`esic_hms_test`) + redis7,
`prisma generate` → `lint` → `typecheck` → `test` (unit only; e2e NOT in CI). 15-min timeout,
`cancel-in-progress`. No Playwright/frontend-e2e, no VAPT, no coverage gate found.

## Known gaps (VERIFIED by absence)

- No frontend e2e dir beyond `e2e/.gitkeep`; no Playwright config found (docs Phase 16 claims it — NOT VERIFIED).
- E2E excluded from CI — concurrency/billing paths verified locally only.
- No failing-test baseline was executed in this task (docs generated without running the suite);
  run the commands above and record results before release.
