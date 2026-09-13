# 14 — Pricing, Catalogue, Facility & Benefit Rules (VERIFIED)

## Service catalogue (`catalog/`)

`ServiceCategory` → `Service{ServiceType, ServiceApplicability(OPD,IPD,BOTH), ServiceUnit, active,
createdBy/updatedBy}` → `ServicePackageItem` (package components — orderable but not standalone-billable
until priced) → `ServicePrice{serviceId, amount, effectiveFrom, effectiveTo?, createdBy}`.
Seeded CGHS rates: `prisma/seeds/catalog-data.ts + catalog.seed.ts` (`seedCatalog` called from `seed.ts`).

`PricingService.resolve(serviceId, at, tx)` (`pricing.service.ts:46-91`):
inactive service → throw; no covering price (`effectiveFrom<=at AND (effectiveTo NULL OR >at)`, latest first)
→ `BadRequest 'No effective price… Set a price in Service Pricing'`.
`resolveMany()` batches with aggregated failures. Only price source for service charges.

Frontend: `ServicePricingScreen.tsx` (Admin/SuperAdmin only). Endpoints: `GET /api/catalog/categories|/services|/services/unpriced|/services/:id`,
`POST /api/catalog/services`, `PUT|PATCH /api/catalog/services/:id`,
`GET /api/catalog/services/:id/price|/price-history`, `POST /api/catalog/services/:id/prices`.

## Facility eligibility (`facility/`)

`FacilityEligibilityRule{postId?, gradeId?, category A,B,C,D,CONTRACTUAL, ward/room/level, active, version, createdBy}`.
Resolve at admission-request time; rule + version recorded per admission (provisional matrix in `docs/03-data-model.md`).
Policy-is-data: no `if(post)` hardcoding (phase-7 acceptance). Admin/SuperAdmin write.
Frontend: `FacilityRulesScreen.tsx`. Endpoints: `GET|POST /api/facility-rules`, `PUT /api/facility-rules/:id`, `GET /api/facility-rules/resolve`.

## Benefit rules (`benefit/`)

`BenefitRule{employmentTypeId, medicineCategory?, outcome FREE|COVERED|PAID, active, version}`.
Seed: Contractual → PAID (editable row). `BenefitRuleService.evaluate(type, medicine)` — single call site for
display + dispense (`benefit-rule.service.ts` + spec; e2e `benefit-rule.e2e-spec.ts`).
Endpoints: `GET|POST /api/benefit-rules`, `PUT /api/benefit-rules/:id`, `GET /api/benefit-rules/evaluate`.
