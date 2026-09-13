# 11 — Therapy / Massage (VERIFIED)

## Model

`TherapyCourse(IN_PROGRESS,COMPLETED,CANCELLED, source DIRECT,OPD,IPD)` → `TherapySession(SCHEDULED,PERFORMED,CANCELLED,NO_SHOW)`.
Source tracking migration: `20260829230210_add_therapy_source_tracking`.

## Three entry points (VERIFIED in grants + code comments)

1. **Direct** — patient books at Registration with no doctor: Reception `TherapySession:create`.
2. **OPD** — doctor orders/schedules: Doctor `TherapySession:create`.
3. **IPD** — ward flow (same create grant; admission context).

Marking performed stays with Nurse (`TherapySession:update`); `can()` mirror:
`therapy:order` (Doctor, Reception, Admin), `therapy:markPerformed` (Nurse).

## Flow

```
POST /api/therapy/courses → course (source recorded)
 → POST /api/therapy/sessions → SCHEDULED
 → POST /api/therapy/sessions/:id/perform (Nurse) → PERFORMED
    → posts per-sitting service charge (therapySessionId) via ChargeService
 → course completion/cancel/no-show transitions
```

Files: `therapy/therapy.controller.ts` (prefix `therapy`), `therapy.service.ts` (+spec).
Frontend: `TherapyConsoleScreen.tsx`.

## Billing link (VERIFIED)

Per-sitting charge cites `therapySessionId` + `serviceId/servicePriceId`
(constraint `charge_items_therapy_requires_service`); a course-package opening charge does NOT set
`therapySessionId` (`charge.service.ts:18-23`).

## Endpoints

`GET /api/therapy/sessions|/courses`, `POST /api/therapy/courses|/sessions`,
`POST /api/therapy/sessions/:id/perform|cancel|no-show`
