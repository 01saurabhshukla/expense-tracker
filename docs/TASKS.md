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
- [ ] **Parsing & analysis — confirmed by the user 2026-10-07** (D18, D19)
      Fixtures: backend/tests/fixtures/statements. Must not delete stored files (D16).
  - [x] 7a: CSV reader: file → rows of strings (quotes, CRLF, BOM). Pure, no DB. (D20)
  - [x] 7b: header detection + column mapping for 5 banks; else UNRECOGNIZED_FORMAT (D21)
  - [x] 7c: row normalization (dates, ₹ paise, Dr/Cr, footers) + per-row errors (D22)
  - [x] 7d-1: BullMQ worker + stages/progress/errors in Postgres;
        `transactions` table; idempotent save; retries; sweep recovery (D23)
  - [x] 7d-2 (D24): row-level dedupe, fingerprint option A (bank reference + date +
        direction + amount + balance; description only as fallback;
        occurrence number) — keep both CHAI POINT ₹20; re-upload of a failed
        parse allowed
  - [ ] 7e: categorization layers 1–3 + 5 (user corrections, type rules,
        merchant rules, Uncategorized); hand-labelled evaluation set + accuracy
  - [ ] 7f: summary (totals, by category, by month) shown when `completed`;
        include a running-balance check (flags gaps/misreads, as in the 7c tests)
  - [ ] 7g: `.xlsx` reader → same grid (reuses 7b–7f)
  - [ ] 7h: LLM layer 4 for leftovers (off by default), measured against 7e
  - [ ] 7i: large files (200k rows): streaming + batched inserts
- [ ] **Decide later:** file retention policy (when, if ever, accepted files
      are deleted; user-initiated delete; account deletion) — T34, T39
- [ ] Reports: dashboard data, CSV/PDF export
- [ ] Frontend (React + Vite)
- [ ] Rate limiter, metrics, tracing, resumable uploads (from Pending above)
- [ ] Deployment: EC2 (backend), separate host (frontend)
- [ ] Docs: README, architecture diagram, self-assessment
