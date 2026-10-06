# Tasks

What's done, what's postponed, and what's coming. One step at a time; each
step updates `DECISIONS.md` and `TRADEOFFS.md` when it lands.

## Done

- [x] Supabase Postgres connection check (`npm run db:check`)
- [x] Repo split into `backend/` and `frontend/` (frontend not created yet)
- [x] Express skeleton: `app.js` / `server.js`, `GET /health`
- [x] Request ID + structured JSON request logging (D7)
- [x] Zod body validation + central error handler with one error shape (D8)
- [x] DB connection pool (D9), migration runner `npm run migrate` (D10),
      `users` table (D11)

## Pending (postponed)

### Rate limiter
Postponed by choice, not blocked. Spec agreed so far:
- `src/middleware/rateLimiter.js`: hand-written `createRateLimiter({ windowMs, max })`,
  fixed window, in-memory `Map` of IP → `{ count, windowStartsAt }`.
- Limits: 100 req/min per IP globally; 10 req / 15 min on `/auth`.
- Exceeding the limit → `AppError(429, 'RATE_LIMITED', …)` + `Retry-After` header.
- Headers on every response: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.
- `app.set('trust proxy', 'loopback')` so the real client IP is used behind nginx.
- Cleanup timer (with `.unref()`) removes expired entries.
- Tests: max 3 → requests 1–3 pass, 4th gets 429 with our error shape.
- Trade-offs already written: T9, T10 in `TRADEOFFS.md`.

### Metrics
Postponed until the core path (DB, auth, CSV upload) exists, so there is real
work to measure. Do it just before deployment.
- `GET /metrics` in Prometheus format via `prom-client`.
- Request count by method / route / status; request duration histogram;
  default Node process metrics (memory, CPU, event loop lag).
- Later: CSV parse time, DB query time, upload success/failure counts.
- Needs a collector to be useful: Prometheus + Grafana or CloudWatch agent on EC2.
- Until then, the JSON request logs (`status`, `durationMs`) cover basic needs.

### Tracing
Postponed for the same reason: traces only help once a request has multiple
steps (middleware → parse CSV → categorize → DB insert).
- OpenTelemetry; reuse the existing request ID so logs and traces link up.
- Do it together with metrics, before deployment.

## Up next (in order)

- [x] Auth (D12), in three sub-steps:
  - [x] 4a: env config (D13), signup (bcrypt hash, 409 on duplicate email)
  - [x] 4b: login, access JWT, `requireAuth` middleware, `GET /auth/me`
  - [x] 4c: refresh token cookie, rotation + reuse detection, logout
  - Frontend must handle: access token in memory, on 401 `TOKEN_EXPIRED` call
    `/auth/refresh` once (shared promise, see T28) then retry; on any other
    401 go to login. Requests to `/auth/*` need `credentials: 'include'`.
- [ ] CSV upload: parsing, categorization, duplicate detection
      (adds `uploads`, `transactions`, `categories` tables as migrations)
- [ ] Reports: dashboard data, CSV/PDF export
- [ ] Frontend (React + Vite)
- [ ] Rate limiter, metrics, tracing (from Pending above)
- [ ] Deployment: EC2 (backend), separate host (frontend)
- [ ] Docs: README, architecture diagram, self-assessment
