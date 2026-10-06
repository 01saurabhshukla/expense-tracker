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

### Resumable uploads (option B)
Chosen for a later stage; uploads currently restart from zero (option A).
- tus protocol: `@tus/server` on the backend, `tus-js-client` in the frontend.
- After a network drop the client asks "how many bytes do you have?"
  (`HEAD` → `Upload-Offset`) and continues from there.
- Needs: storage for partial uploads, expiry + cleanup job for abandoned ones,
  the same fail-closed checks (D14) run once the upload completes.
- Trade-off entry: T32.

## Up next (in order)

- [x] Auth (D12), in three sub-steps:
  - [x] 4a: env config (D13), signup (bcrypt hash, 409 on duplicate email)
  - [x] 4b: login, access JWT, `requireAuth` middleware, `GET /auth/me`
  - [x] 4c: refresh token cookie, rotation + reuse detection, logout
  - Frontend must handle: access token in memory, on 401 `TOKEN_EXPIRED` call
    `/auth/refresh` once (shared promise, see T28) then retry; on any other
    401 go to login. Requests to `/auth/*` need `credentials: 'include'`.
- [x] Upload (D14): file intake only, no parsing
  - [x] 5a: `uploads` table (migration 003) + `POST /uploads`: auth before
        body, streaming via busboy to a temp file, size limit, cleanup on
        abort, SHA-256, empty / non-UTF-8 / NUL-byte rejection, 409 on duplicate
        (response includes the existing upload id)
  - [x] 5a+: `stored_files` table (migration 004): path mapped to user (D16)
  - [x] 5b: `GET /uploads`, `GET /uploads/:id` (other users' → 404) (D17)
  - [x] 5c: edge-case tests: dropped connection, size limits (declared,
        streamed, exact boundary), two files, broken multipart, all sample
        statements (copied to `backend/tests/fixtures/statements/`)
  - Network drops: restart from zero (A) now; resumable (B) is in Pending
- [x] Excel upload gate (D15): `.xlsx` only; inspect the zip's
      table of contents first (max uncompressed size, max ratio, max entries);
      reject `.xls` with "save as .xlsx or CSV"
- [ ] **Parsing — confirmed by the user 2026-10-07.**
      Header detection, column mapping per bank, dates/amounts, Dr/Cr,
      per-row Zod validation, row-level dedupe, categorization.
      Fixtures: backend/tests/fixtures/statements (HDFC, SBI, ICICI, Axis, Kotak + edge cases)
      **Must not delete the stored file**, on success or failure (D16).
      Needs: a way to re-upload a file whose parse failed (today it gets
      409 DUPLICATE_FILE) — e.g. `UNIQUE … WHERE status <> 'failed'`.
- [ ] **Decide later:** file retention policy (when, if ever, accepted files
      are deleted; user-initiated delete; account deletion) — T34, T39
- [ ] Reports: dashboard data, CSV/PDF export
- [ ] Frontend (React + Vite)
- [ ] Rate limiter, metrics, tracing, resumable uploads (from Pending above)
- [ ] Deployment: EC2 (backend), separate host (frontend)
- [ ] Docs: README, architecture diagram, self-assessment
