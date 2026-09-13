# 02 — System Architecture (VERIFIED)

## High-level architecture

```
User (browser)
  ↓  HTTPS / Vite dev proxy (/api → :3000)
React 18 SPA (apps/web, :5173 dev)
  ↓  apiFetch + Bearer JWT (apps/web/src/api/client.ts, http.ts)
NestJS 10 API, global prefix /api (apps/api/src/main.ts:15,45)
  ↓  JwtAuthGuard (APP_GUARD 1) → RbacGuard (APP_GUARD 2) → ValidationPipe → Controller
Services / business logic (apps/api/src/modules/*)
  ↓  PrismaService (apps/api/src/common/prisma)
PostgreSQL 15 (system of record; 57 models)
  +  Redis 7 (ioredis 5.4.2 — present as dependency; token/queue usage per docs §5)
  +  Puppeteer 25.9 (PDF: receipts, statements, lab reports)
  +  qrcode 1.5.4 (UID cards)
```

## Repository structure (abridged)

```
ESIC/
  apps/api/            NestJS backend (@esic-hms/api)
    src/main.ts        global prefix, pipes, CORS, serverless (Vercel) + local bootstrap
    src/app.module.ts  21 modules + 2 APP_GUARDs + APP_INTERCEPTOR + SecurityMiddleware
    src/modules/*      one dir per domain (controller/service/module/dto[/spec])
    src/common/        decorators, guards, filters, interceptors, middleware, prisma, sequence, rendering
    src/health/        GET /api/health (@Public)
    prisma/            schema.prisma (57 models), migrations (10+init), seed.ts (1199 lines), seeds/
    test/              15 e2e specs + jest-e2e.json
    Dockerfile         node:20-alpine, pnpm 9.15.4, EXPOSE 3000, CMD pnpm start:dev
    vercel.json/index.js  serverless wrapper (require ./dist/main.js)
  apps/web/            React frontend (@esic-hms/web)
    src/App.tsx        BrowserRouter + AuthProvider gate (LoginPage vs AppShell)
    src/components/layout/AppShell.tsx  PageId router (pathForPageId/pageIdFromPath/renderPage)
    src/components/layout/Sidebar.tsx    PageId union (24), MENU_GROUPS, per-role visibility
    src/api/*.api.ts   24 per-domain fetch modules (token passthrough, unwrap)
    src/hooks/useAuth.ts  localStorage esic-hms-auth {token,user,expiresAt 8h}, 60s poll
    src/screens/*      domain screens; src/pages/*  reception/doctor/pharmacy workspaces
  docker-compose.yml   postgres:15 (5433→5432), redis:7, api (:3000), web (:5173)
  .github/workflows/ci.yml  lint + typecheck + test on pg15/redis7 services
  docs/                00–08 intent briefs (reference) + developer/ (this package)
```

## Technology stack (VERIFIED — exact versions)

| Layer | Technology | Evidence |
|---|---|---|
| Runtime | Node >= 20 (`.nvmrc` = `20`) | `package.json:engines`, `.nvmrc` |
| Workspaces | pnpm 9.15.4, turbo 2.3.3 | root `package.json`, `pnpm-workspace.yaml` (`apps/*`) |
| Backend | NestJS 10.4.15, Passport 0.7 + passport-jwt 4.0.1 + passport-local 1.0.0, @nestjs/jwt 10.2.0 | `apps/api/package.json` |
| ORM / DB | Prisma 5.22.0, PostgreSQL 15-alpine | `schema.prisma`, `docker-compose.yml`, CI |
| Cache/queue | ioredis 5.4.2, @nestjs/schedule 4.1.2, Redis 7 | `package.json`, compose, `ScheduleModule.forRoot()` |
| Validation | class-validator 0.14.1 + class-transformer 0.5.1, global `ValidationPipe{whitelist,forbidNonWhitelisted,transform}` | `main.ts:17-23` |
| Auth crypto | bcryptjs 2.4.3 | `auth.service.ts`, `doctor.service.ts`, `seed.ts` |
| Documents | puppeteer ^25.9.0, qrcode 1.5.4 | `package.json`; `rendering/` module |
| Logging | pino 9.6.0 + pino-pretty 13.0.0 | `package.json` |
| Health | @nestjs/terminus 10.2.3 | `package.json`, `health/` |
| Frontend | React 18.3.1, Vite 5.4.11, TS 5.7.3, react-router-dom 6.28.1, Tailwind 3.4.17, framer-motion 12, lucide-react 1.26, recharts 3.10 | `apps/web/package.json` |
| Frontend tests | vitest 2.1.8, jsdom 25, testing-library 16 | `apps/web/package.json` |

NOT VERIFIED as executing code: TanStack Query, react-hook-form, zod, shadcn/ui, BullMQ jobs,
S3/MinIO, Sentry, Prometheus/Grafana (listed in `docs/02-tech-stack.md` but no matching
dependency or module was found in `apps/api|web/package.json` or `src/`).

## Runtime architecture

| Concern | Local dev | Docker | Production |
|---|---|---|---|
| DB | `DATABASE_URL` localhost (5432 or 5433 — see §20) | `postgres:5433→5432`, volume `postgres_data`, healthcheck `pg_isready` | NOT VERIFIED — no prod manifest; `vercel.json` suggests serverless API was attempted |
| Cache | `REDIS_URL` localhost:6379 | `redis:6379`, AOF on, healthcheck ping | NOT VERIFIED |
| API | `pnpm --filter @esic-hms/api dev` → `:3000` | `api:3000`, mounts `src+prisma+test`, `depends_on` healthy pg+redis | `start:prod: node dist/main` (no prod compose/K8s found) |
| Web | `vite` → `:5173`, `/api` proxied to `VITE_API_PROXY_TARGET \|\| 127.0.0.1:3000` | `web:5173`, `VITE_API_PROXY_TARGET=http://api:3000` | `tsc -b && vite build` → `dist/` (no static-host config found) |
| Env | repo-root `.env.example`; `apps/api/.env` exists locally | compose `environment:` blocks | `CHANGE_ME_IN_PRODUCTION` placeholders — must be replaced |

Startup sequence: `docker compose up` (pg+redis healthy) → api (`prisma generate` at build, `nest start --watch`) →
web (vite). Bare-metal: `pnpm install` → `prisma generate` → `prisma migrate deploy` →
`prisma db seed` → `turbo run dev`. First request: `GET /api/health` (`@Public()`).

## Request lifecycle (VERIFIED example: `POST /api/prescriptions`)

1. Frontend `prescription.api.ts` → `apiFetch('/prescriptions', {method POST, Bearer})`.
2. `SecurityMiddleware` sets HSTS/CSP/nosniff/DENY + CSRF fallback check (`security.middleware.ts:6-38`).
3. `JwtAuthGuard` (global): `@Public()`? No → `passport-jwt` validates Bearer with `JWT_ACCESS_SECRET`, rejects non-`access` (`jwt.strategy.ts`).
4. `RbacGuard` (global): needs `RequirePermission('Prescription','create')`; SuperAdmin bypass; else match `user.permissions` (`rbac.guard.ts:40-69`).
5. `ValidationPipe`: whitelist + forbid + transform → DTO (`login.dto.ts` pattern; per-module `dto/`).
6. Controller → Service → `PrismaService` → PostgreSQL (single `$transaction` where atomicity matters: dispense, bed allocate, doctor create).
7. `AuditInterceptor` (global): on POST, writes `AuditLog{actor, action, entityType, entityId, before/after}` except `auth`/`health` paths.
8. JSON response → `http.ts unwrap` → screen `useState` update; errors surfaced via `extractErrorMessage` (joins ValidationPipe `string[]`).
