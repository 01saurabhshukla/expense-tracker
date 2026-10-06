# Decisions

A running log of the choices made in this project and why. When a decision
changes, don't delete the old entry; mark it **Superseded** and add a new one.

Each entry: **Decision**, **Why**, **Trade-off** (what we gave up).
The full list of trade-offs, with when they hurt and how to fix them, lives in
[TRADEOFFS.md](TRADEOFFS.md).

---

## D1 — Plain JavaScript, no TypeScript
- **Decision:** Backend and frontend are written in plain JS (ES modules).
- **Why:** Keep the toolchain small so every line is readable and understood.
- **Trade-off:** No compile-time type checking. Zod covers runtime validation
  at the edges (requests, env vars), which is where bad data actually enters.

## D2 — One repo, two independent apps
- **Decision:** `backend/` and `frontend/` live in one repo, each with its own
  `package.json`, dependencies and `.env`. They talk only over HTTP.
- **Why:** They will be hosted separately; keeping them independent means each
  can be built and deployed on its own.
- **Trade-off:** Some config (e.g. API URL, allowed origins) must be kept in
  sync by hand. Requires CORS and cross-site-aware auth (see Open questions).

## D3 — Supabase as plain Postgres, own auth
- **Decision:** Use Supabase only as a hosted Postgres database via
  `DATABASE_URL` and the `pg` driver. Sign-up/login are built in the backend.
- **Why:** Building auth is an assignment deliverable and a learning goal; one
  secret to manage instead of three.
- **Trade-off:** We own password hashing, sessions and their security.

## D4 — Node's built-in `--env-file` instead of `dotenv`
- **Decision:** Load `.env` with `node --env-file=.env`.
- **Why:** Node 24 supports it natively; one less dependency.
- **Trade-off:** Requires Node ≥ 20.6 wherever the backend runs.

## D5 — Layered backend
- **Decision:** Request flow is middleware → routes → services → db/queries.
  `app.js` builds the app; `server.js` only starts it.
- **Why:** Each layer has one job, so bugs are easy to locate, and tests can
  use `app.js` without opening a real port.
- **Trade-off:** More files than a single-file Express app.

## D6 — Backend hosted on AWS EC2
- **Decision:** Run the backend as a long-lived Node process on an EC2 instance.
- **Why:** Everything we build works in its standard form there: an in-memory
  rate limiter, a Prometheus-style `/metrics` endpoint, normal tracing, and no
  request-size cap on CSV uploads. It's also real infrastructure experience.
- **Trade-off:** We own the server: OS updates, a process manager (e.g. pm2),
  HTTPS (nginx + Let's Encrypt), security groups. Considered Lambda (needs
  shared state for rate limiting, small upload limits) and Render/Railway
  (easier, less control, sleeps on free tier).

## D7 — Hand-written request ID + JSON logger (for now)
- **Decision:** Two small middlewares: `requestId` (reuse a safe incoming
  `X-Request-Id`, else generate a UUID) and `requestLogger` (one JSON line per
  request with status and duration).
- **Why:** Learning goal — every line is visible. Reusing an incoming ID lets
  nginx and the app share one ID per request; the format check stops anyone
  injecting junk into our logs through that header.
- **Trade-off:** No log levels config, redaction or fast async writes. If
  logging grows, swap in `pino` / `pino-http`; the JSON shape stays similar.
- **Testing:** Node's built-in `node:test` + `fetch`; no Jest/supertest.

## D8 — Zod validation + one error shape for every failure
- **Decision:** Routes declare a Zod schema via `validateBody(schema)`. All
  errors flow to one `errorHandler`, which always responds with
  `{ error: { status, code, message, details?, requestId } }`. The HTTP status
  line is the source of truth; `status` in the body is a copy for anyone
  reading only the JSON (logs, pasted bug reports), as in RFC 9457.
- **Why:** Handlers only ever see clean, typed-as-expected data. The frontend
  handles one error format. `code` is for code, `message` is for humans,
  `requestId` links a user's report to the log line.
- **Details:** Zod strips unknown fields; email is trimmed + lowercased;
  password max 72 (bcrypt's limit); JSON body limit 100kb (CSV upload gets its
  own limit later). Unexpected errors return a generic 500 message — the real
  error and stack go only to the logs, never to the client.
- **Query strings:** `validateQuery(schema)` stores the cleaned values on
  `req.validatedQuery`, because `req.query` is read-only in Express 5.
  Handlers read from there, never from `req.query`.

## D9 — One shared connection pool
- **Decision:** `src/db/pool.js` exports a single `pg.Pool` (max 10
  connections, 30s idle timeout, 5s connect timeout). The app never opens
  one-off connections.
- **Why:** Opening a Postgres connection costs a network round trip, TLS setup
  and auth. A pool keeps a few open and lends them to requests. Supabase allows
  60 connections in total (shared with its own services), so 10 leaves room.
- **Details:** Fails fast with a clear message if `DATABASE_URL` is missing
  (otherwise `pg` silently tries localhost). Has an `error` listener so a
  dropped idle connection is logged instead of crashing the process.

## D10 — Plain SQL migrations with a hand-written runner
- **Decision:** Schema changes are numbered `.sql` files in
  `src/db/migrations/`. `npm run migrate` runs each unapplied file once, in
  name order, inside a transaction, and records it in `schema_migrations`.
- **Why:** Every schema change is in git and reproducible on any database
  (local, EC2, a fresh Supabase project). Never edit tables by hand in the
  dashboard. Hand-written (~50 lines) so every step is visible.
- **Rule:** Never edit a migration that has already been applied; add a new
  numbered file instead.

## D11 — `users` table design
- **Decision:** `id uuid DEFAULT gen_random_uuid()`, `email text UNIQUE` with a
  `CHECK (email = lower(email))`, `name`, `password_hash`, `created_at timestamptz`.
  Row Level Security enabled on every table we create.
- **Why:**
  - UUID ids can't be guessed or counted (`/users/2` → "try 3"), and don't
    reveal how many users exist.
  - Zod already lowercases emails; the CHECK is a second guard so
    `A@x.com` and `a@x.com` can never both exist, even if some future code
    path skips Zod.
  - `timestamptz` stores an absolute moment, avoiding timezone bugs (users in
    IST, server in UTC).
  - Supabase auto-exposes the `public` schema through a REST API reachable
    with its public key. RLS with no policies blocks that API entirely. Our
    backend connects as `postgres` (bypasses RLS), so it's unaffected.
- **Note:** Supabase has its own `auth.users` table (unused by us). Ours is
  `public.users`; different schema, no conflict.

## D13 — Environment variables validated with Zod at startup
- **Decision:** `src/config/env.js` validates `process.env` with a Zod schema
  and exports a typed `env` object. All code reads `env.X`, never
  `process.env.X` directly.
- **Why:** A missing or malformed variable stops the server at startup with
  a clear list of problems, instead of failing later on some user's request.
  `PORT` arrives as a string; `z.coerce.number()` converts it.

## D12 — Auth: short access JWT + rotating refresh token in a cookie
- **Decision:**
  - **Access token:** JWT, 15 min, returned in the JSON body, kept in frontend
    memory (never `localStorage`), sent as `Authorization: Bearer …`. Verified by
    signature only — no DB lookup.
  - **Refresh token:** random 256-bit value, 7 days, `httpOnly` cookie scoped to
    `Path=/auth`, stored in the DB **as a SHA-256 hash**. Rotated on every use;
    reusing an old one revokes the whole session family.
- **Why:** The credential sent constantly is short-lived; the long-lived one is
  invisible to JavaScript, rarely sent, and revocable. Also a learning goal.
- **Signup (4a):** bcrypt cost 12. Duplicate emails are caught by the
  database's UNIQUE constraint (Postgres error `23505` → 409 `EMAIL_TAKEN`),
  not by "SELECT, then INSERT", which two simultaneous signups could slip past.
  The password hash is never selected back out to the API.
- **Login (4b):** HS256 JWT with `sub` = user id, 15 min, algorithm pinned on
  verify (blocks `alg: none` and algorithm-swap forgeries). Wrong password and
  unknown email return the identical 401 `INVALID_CREDENTIALS`, and unknown
  emails are compared against a dummy bcrypt hash so both take the same time.
  `requireAuth` distinguishes `TOKEN_EXPIRED` (frontend should refresh) from
  `INVALID_TOKEN` / `UNAUTHENTICATED` (frontend should go to login). Login
  schema has no length rules so rule changes never lock out existing users.
- **Refresh (4c):**
  - Cookie `refresh_token`: `HttpOnly`, `SameSite=Lax`, `Path=/auth`, 7 days,
    `Secure` when `NODE_ENV=production`. Never in a response body.
  - Token = 32 random bytes; DB stores SHA-256 of it (deterministic, so it
    can be looked up; bcrypt's random salt would make lookup impossible, and
    a 256-bit random value can't be brute-forced anyway).
  - `POST /auth/refresh` runs in one transaction with `SELECT … FOR UPDATE`:
    revoke old → insert new (same `family_id`). A revoked token presented again
    → revoke the whole family → 401 `REFRESH_TOKEN_REUSED`. Any failure also
    clears the cookie.
  - `POST /auth/logout` revokes the family and clears the cookie; always 204.
  - `withTransaction(fn)` helper: query functions take `db` (pool or
    transaction client) as their first argument so they work in both.
- **Rejected:** Server-side sessions (simpler, instantly revocable; a fine fit
  for one server) — chose B to learn the pattern. Long-lived JWT in
  `localStorage` — stealable by XSS and not revocable.

## D14 — Uploads: fail closed, two gates, nothing trusted from the client
- **Decision:** A file must pass every check before an `uploads` row exists:
  auth (before reading the body) → byte-counted size limit while streaming →
  temp file with a server-generated name → content checks (non-empty, valid
  UTF-8, no NUL bytes) → SHA-256 duplicate check. File name, extension and
  `Content-Type` are never trusted. Parsing is a second, separate gate that
  checks meaning (is it a bank statement, is each row valid).
- **Why:** The upload gate proves a file is safe and well-formed; it cannot
  prove it's a statement (e.g. 4 KB of "vvvv" is valid text). Splitting the
  gates keeps each one simple and testable.
- **Network drops:** an aborted request deletes its temp file and creates no
  row. The client retries from zero (statements are KBs, not GBs). A retry
  after a drop that actually succeeded server-side gets 409 with the existing
  upload's id, which the client treats as success.
- **Implementation (5a):** `POST /uploads`, multipart field `file`, parsed
  with `busboy` (limits: 1 file, 0 fields, 10 MB via `UPLOAD_MAX_BYTES`;
  a file of exactly the limit is allowed). Note: busboy fires its limits when
  a count *reaches* the limit, so `fileSize` is set to `max + 1` and no
  `parts` limit is used — both bugs were caught by tests.
  `Content-Length` over the limit → 413 + `Connection: close` before reading
  the body. File streams through a byte counter + SHA-256 into
  `storage/tmp/<random uuid>`; after the checks pass it's renamed (atomic,
  same disk) to `storage/files/<upload id>`. Folders are `0700`. The
  client's file name is only displayed: directory parts, control characters
  and anything past 255 chars are stripped. Only `.csv` accepted for now.
  CSV content check: valid UTF-8 (`TextDecoder` fatal) and no NUL bytes.
  Duplicate = same user + same SHA-256 (checked first, `UNIQUE` catches races).
- **Later (decided, not built):** resumable uploads via the tus protocol
  (option B), so a dropped upload continues from the last received byte.
  Same fail-closed checks run when the upload completes. See TASKS.md →
  Pending and T32.

## D15 — Spreadsheets: `.xlsx` only, zip inspected before parsing
- **Decision:** Accept `.xlsx` (via `exceljs` from npm); reject legacy `.xls`.
  Before parsing, read only the zip's table of contents and reject on
  excessive uncompressed size, compression ratio or entry count.
- **Why:** Legacy `.xls` is a complex binary format; the only library that
  reads it (SheetJS) no longer publishes fixes to npm. `.xlsx` is a zip, so
  checking sizes up front stops zip bombs before any decompression.
- **Readers design:** each format has a reader that turns a file into a grid
  of strings; one shared pipeline turns the grid into transactions.
- **Implementation (step 6):** `src/services/xlsxChecks.js` with `yauzl`
  (`strictFileNames`, `validateEntrySizes`). Order of checks:
  1. First bytes: OLE2 signature (old `.xls` or password-protected workbook)
     → 415 `LEGACY_OR_PROTECTED_WORKBOOK`; not `PK\3\4` → 400 `INVALID_XLSX`.
  2. Table of contents: > 200 entries → `XLSX_TOO_COMPLEX`; declared total
     > 50 MB → `XLSX_TOO_LARGE`; any entry > 1 MB with ratio > 100:1 →
     `SUSPICIOUS_COMPRESSION`; encrypted entry or unsafe name → `INVALID_XLSX`.
  3. **Every entry is actually decompressed and discarded.** Declared sizes
     are claims made by the file's author; yauzl aborts the moment real
     output exceeds the claim (tested with a zip that claims 1,000 bytes for
     a 2 MB entry: stopped after 16 KB).
  4. Must contain `[Content_Types].xml` and `xl/workbook.xml`.
  The extension picks which checks run; the content must agree (an `.xlsx`
  renamed `.csv` fails the text check, a CSV renamed `.xlsx` fails the zip
  check). Migration 005 allows `format = 'xlsx'`. No cell is read here —
  reading sheets is parsing.

## D16 — Accepted files are kept; their location is mapped per user
- **Decision:**
  - A file that was received completely and passed every check is **never
    deleted** — not after parsing, not on parse failure. When (or whether)
    to delete is an open question, decided later.
  - Only files that never became an accepted upload are deleted: aborted
    transfers, rejected files, or a failure before the DB rows were saved.
  - `stored_files` maps each file to its owner: `upload_id`, `user_id`,
    `storage_backend` ('local'), `storage_path` (relative to `UPLOAD_DIR`,
    e.g. `files/<upload id>`). Saved in the same transaction as the `uploads`
    row, so neither exists without the other.
  - `(upload_id, user_id)` is a foreign key to `uploads (id, user_id)`: the
    database itself refuses a mapping that names a different owner.
- **Why:** User's decision: keep originals until a retention policy is agreed.
  A separate table keeps storage details (local disk today, maybe S3,
  retention dates later) apart from upload metadata and status.
- **Why relative paths:** moving the storage folder or the server only
  changes `UPLOAD_DIR`, not every row. The CHECK rejects absolute paths and `..`.

## D17 — Reading uploads: owner-only, one 404 for everything else
- **Decision:** `GET /uploads` (newest first, `limit` 1–100 default 20,
  `offset` 0–10,000) and `GET /uploads/:id`. Every query filters by
  `user_id`. Another user's upload, an unknown id and a malformed id all
  return the identical 404 `UPLOAD_NOT_FOUND`.
- **Why:** A different answer for "exists but isn't yours" (403) would let
  anyone confirm which ids exist. The id format is checked before querying,
  because Postgres rejects a malformed uuid with an error that would surface
  as a 500.
- **Details:** Pagination fetches `limit + 1` rows to compute `hasMore`
  without a separate `COUNT(*)`. Order is `created_at DESC, id DESC`; the id
  tie-breaker keeps the order stable. Responses never include `sha256` or
  the storage path. `requireAuth` is applied once to the whole router.

## D18 — Parsing runs in the background; the frontend polls stage + progress
- **Decision:** `POST /uploads` runs only the fast safety gate (D14/D15) and
  replies `201` with the upload id. A background worker then moves the upload
  through stages: `queued → reading → validating → categorizing →
  summarizing → completed` (or `failed` with a reason). Stage, progress
  counters and the final summary are stored in the database;
  `GET /uploads/:id` returns them, and the frontend polls it (~2s).
- **Why:** User's decision: categorization and analysis may be slow; the user
  must never be stuck waiting on the upload request, and must see each step.
- **Two kinds of validation:** the safety gate stays *in* the request (fast,
  and a dangerous file must be refused before it's ever stored); row-level
  validation (dates, amounts, bank format) is the background `validating`
  stage.
- **Runner:** in-process job runner with a small concurrency limit (e.g. 2).
  On startup, uploads stuck mid-stage are re-queued (safe: files are never
  deleted, D16, and processing must be repeatable). No Redis/queue service.
- **Bad rows:** good rows are saved; bad rows are reported with row number and
  reason ("52 imported, 2 skipped"). Default chosen because the user didn't
  pick; matches the sample README's expectation.
- **Money:** stored as integer paise (₹1,250.00 → 125000) to avoid
  floating-point drift in totals.

## D19 — Categorization: layered rules first, LLM only for the leftovers
- **Decision:** Each transaction goes through layers, first match wins:
  1. the user's own corrections (remembered per merchant),
  2. transaction-type rules (ATM/NWD → Cash, SALARY → Income, INTEREST,
     SIP/MUTUAL FUND → Investments),
  3. merchant rules (UPI handle or keyword → category),
  4. LLM for what's still unknown (later sub-step),
  5. otherwise `Uncategorized`.
  Every transaction stores which layer decided (`user`/`rule`/`llm`/`none`).
- **LLM guardrails:** off by default (`CATEGORIZER_LLM_ENABLED`); sends only
  the merchant text (account/card numbers, names, amounts stripped); one
  batched call per statement; result cached per merchant; answer must be one
  of our category names or it's discarded.
- **Why:** User wants a mix but doesn't know which performs best. Rules are
  free, fast, predictable and testable; the LLM covers the long tail.
- **How we'll decide "best":** a hand-labelled evaluation set built from the
  sample statements; measure accuracy and % uncategorized for rules alone,
  then rules + LLM (plus cost and time per statement).

## D20 — CSV reader: `csv-parse`, read row by row, judge nothing
- **Decision:** `src/parsing/readers/csvReader.js` is an async generator
  yielding `{ line, cells }` per row, using `csv-parse` (zero dependencies,
  maintained, streaming). Options: strip BOM, allow varying column counts,
  keep stray quotes inside unquoted cells as characters, skip only truly
  empty lines, 64 KB max per row.
- **Why:**
  - Row by row: a 200k-row file never sits in memory (needed for 7i).
  - Hand-writing CSV quoting rules (quotes, escaped quotes, commas and line
    breaks inside quotes) is easy to get subtly wrong; this is a solved problem.
  - The reader only answers "what are the cells?". Preamble, short rows,
    footers and text in amount columns pass through untouched for the next
    stages to judge, keeping each stage simple and testable.
  - Line numbers are the file's real line numbers (blank lines skipped but
    counted), so error messages point at the right line.
- **Errors:** invalid CSV (unclosed quote, giant row) → `ParseError`
  `MALFORMED_CSV` with a line number. `ParseError` (`src/parsing/errors.js`)
  has no HTTP status: it's recorded on the upload as the failure reason.

## D21 — Header detection by column-name aliases, not per-bank code
- **Decision:** `src/parsing/columns.js`. Each heading is normalized
  (lowercase, punctuation → spaces) and matched against an alias list per
  field (`date`, `valueDate`, `description`, `reference`, `debit`, `credit`,
  `amount`, `direction`, `balance`, `balanceDirection`). Aliases are tried in
  priority order and a column can be claimed only once. The first row (within
  30) that names a date, a description and a usable amount layout is the
  header; everything before it is preamble and ignored.
- **Two layouts:** `split` (separate debit/credit columns: HDFC, SBI, ICICI,
  Axis) and `amount-with-flag` (one amount + Dr/Cr column: Kotak). Anything
  else → `ParseError UNRECOGNIZED_FORMAT`.
- **Why:** One table of names covers all five banks and any future bank
  that uses similar headings, without a code path per bank. Priority order
  solves "Transaction Date" vs "Value Date"; claim-once + field order solves
  Kotak's two "Dr / Cr" columns.
- **Output:** `findHeader()` → `{ index, line, columns, layout }`;
  `pickFields(cells, columns)` → raw strings by field name (normalizing them
  is 7c).

---

## Revisit before deploying

Things that are fine for local dev but must change for production.

- [ ] **DB connection string:** local uses the direct (IPv6-only) host. EC2
      only has IPv6 if the VPC/subnet is configured for it → either enable
      IPv6 on the instance or switch `DATABASE_URL` to the Supabase pooler.
- [ ] **EC2 setup:** pm2 (restart on crash/reboot), nginx + HTTPS, security
      group allowing only 80/443 (+ SSH from your IP).
- [ ] **DB SSL:** `rejectUnauthorized: false` encrypts but doesn't verify the
      server certificate. Download Supabase's CA cert and verify it.
- [ ] **CORS:** allow only the deployed frontend's origin.
- [ ] **DB role:** app should use a limited role, not `postgres` (T20).
- [ ] **NODE_ENV=production** on EC2, or the refresh cookie lacks `Secure` (T30).
- [ ] **nginx `client_max_body_size 11m`**: caps upload bodies before they reach Node (T36).
- [ ] **Encrypted EBS volume** for `storage/` (T34).

## Open questions

- **Auth transport:** httpOnly cookie (needs `SameSite=None; Secure` across
  domains) vs `Authorization: Bearer` token. Decide when building auth.
