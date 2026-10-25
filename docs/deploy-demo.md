# Deploy the online demo (Fly.io)

Single app `frontend-moniter-demo` serves:

| Path | Content |
| --- | --- |
| `/` | Vue demo (triggers SDK reporting) |
| `/platform/` | Monitoring platform UI |
| `/api/v1/*` | Report + query API |
| SQLite | Volume at `/data/monitoring.sqlite` (3-day retention) |

## Prerequisites

- [Fly CLI](https://fly.io/docs/flyctl/install/) installed and logged in (`fly auth login`)
- Docker available locally (optional, for smoke tests)

## First-time setup

```bash
fly apps create frontend-moniter-demo
fly volumes create moniter_data --app frontend-moniter-demo --region sin --size 1
fly deploy
```

Use one machine only while a volume is attached (SQLite is single-node).

## Redeploy

```bash
fly deploy
```

## Local Docker smoke test

```bash
docker build -t frontend-moniter-demo .
docker run --rm -p 8080:8080 \
  -e DEMO_ORIGINS=http://localhost:8080 \
  -e REPORT_DB_PATH=/tmp/monitoring.sqlite \
  frontend-moniter-demo
```

Then open:

- http://localhost:8080/
- http://localhost:8080/platform/
- http://localhost:8080/api/v1/health

## Environment

| Variable | Default in image / fly.toml | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `STATIC_ROOT` | `/app/public` | `demo/` + `platform/` static roots |
| `REPORT_DB_PATH` | `/data/monitoring.sqlite` | SQLite file on the volume |
| `RETENTION_DAYS` | `3` | Auto-cleanup window |
| `DEMO_ORIGINS` | `https://frontend-moniter-demo.fly.dev` | Origins allowed for colocated `.map` fetch |
| `CORS_ORIGINS` | `*` | Browser CORS allowlist |

Production Vite env files:

- `demo/.env.production` → `VITE_MONITOR_URL=/api/v1/reportData`
- `platform/.env.production` → `VITE_SERVER_URL=` (same-origin)

## Acceptance check

1. Open the demo URL, run a scenario that reports an error or performance event.
2. Open `/platform/`, select app `vue-demo`, confirm the event appears.
3. Confirm `GET /api/v1/health` returns `{ "status": "ok", "apiVersion": "v1" }`.
