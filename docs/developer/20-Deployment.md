# 20 — Deployment (VERIFIED — real process only)

## Prerequisites

Node 20 (`.nvmrc`), pnpm 9.15.4 (`corepack enable && corepack prepare pnpm@9.15.4 --activate`),
PostgreSQL 15, Redis 7, `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET`
(replace `CHANGE_ME_IN_PRODUCTION` / `dev_*` defaults).

## Environment variables

| Var | Local (VERIFIED) | Docker | Notes |
|---|---|---|---|
| `DATABASE_URL` | `postgresql://esic_user:esic_password@localhost:5432/esic_hms` (`.env.example`); live `apps/api/.env` uses `:5432`; compose maps host `5433→5432` — use 5433 from host when compose pg is up | `postgresql://…@postgres:5432/esic_hms` | Mismatch 5432/5433 is the #1 local gotcha |
| `REDIS_URL` | `redis://localhost:6379` | `redis://redis:6379` | |
| `API_PORT` / `WEB_PORT` | 3000 / 5173 | same | |
| `VITE_API_URL` | `http://localhost:3000` | same | browser-facing base |
| `VITE_API_PROXY_TARGET` | `http://127.0.0.1:3000` | `http://api:3000` | server-side proxy target (container DNS) |
| `JWT_ACCESS_SECRET/REFRESH` | `dev_*` fallback compiled in (`auth.service.ts`, `jwt.strategy.ts`) | unset in compose (falls back!) | MUST set in any shared env |
| `NODE_ENV` | development | development | |

## Local development (VERIFIED)

```
pnpm install
cd apps/api && npx prisma generate && npx prisma migrate deploy && npx prisma db seed
pnpm dev            # turbo: api :3000 + web :5173
# smoke: GET http://localhost:3000/api/health ; open http://localhost:5173
```

## Docker (VERIFIED — `docker-compose.yml`)

`docker compose up` → `postgres` (healthy `pg_isready`) + `redis` (AOF, ping) → `api`
(`depends_on` healthy, mounts `src+prisma+test`, `CMD pnpm start:dev`) → `web`
(`VITE_API_PROXY_TARGET=http://api:3000`, HMR mounts). Volumes persist pg + redis data.

## Production reality (honest)

- `apps/api`: `build: prisma generate && nest build`; `start:prod: node dist/main`. Dockerfiles run `start:dev`, not prod.
- `apps/web`: `build: tsc -b && vite build` → `dist/`. No static-host / reverse-proxy / TLS / WAF config found.
- `vercel.json + index.js`: serverless API attempt (`require ./dist/main.js`, all routes → index.js).
- No staging/prod compose, K8s manifests, backup cron (`pg_dump` in docs §08 is NOT VERIFIED in repo),
  or health-check wiring beyond `terminus` dep + `/api/health` were found.
- Logs: pino (+pretty); troubleshooting: 401 → token/secret mismatch; CSRF 403 → missing Bearer on mutating call
  (middleware fallback); charge 400 `No effective price` → price the service; FEFO empty → quarantine/expiry state.

## Ports

`5433→5432` pg (compose host view), `6379` redis, `3000` api, `5173` web. CI pg on `5432`.
