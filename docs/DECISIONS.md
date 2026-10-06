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
  summarizing → completed` (or `failed` with a reason) — *since 7i (D28):
  `queued → reading → importing → saving → completed`*. Stage, progress
  counters and the final summary are stored in the database;
  `GET /uploads/:id` returns them, and the frontend polls it (~2s).
- **Why:** User's decision: categorization and analysis may be slow; the user
  must never be stuck waiting on the upload request, and must see each step.
- **Two kinds of validation:** the safety gate stays *in* the request (fast,
  and a dangerous file must be refused before it's ever stored); row-level
  validation (dates, amounts, bank format) is the background `validating`
  stage.
- **Runner:** ~~in-process job runner~~ **Superseded by D23 (BullMQ + Redis).**
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

## D22 — Row normalization: real values, per-row errors, a Zod final guard
- **Decision:** `src/parsing/values.js` (single cells) and
  `src/parsing/normalize.js` (whole rows). Each data row becomes a
  transaction, a skip, or a row error `{ line, code, message }`.
  - **Dates** → `'YYYY-MM-DD'` strings, day-first, formats `dd/mm/yy`,
    `dd/mm/yyyy`, `dd-mm-yyyy`, `d Mon yyyy`, `dd-Mon-yyyy`; real calendar
    dates only (no 31/02), years 2000–2099. A string, not a JS `Date`, so no
    timezone can shift it.
  - **Amounts** → whole paise via integer maths; commas only in a correct
    Indian or Western grouping; empty/`-` = no amount; `0.00` = zero (ICICI's
    unused column); negatives and `(…)` rejected; > ₹100 crore rejected.
  - **Direction** from the layout: split columns (both filled → error) or
    Amount + Dr/Cr. Balance optional; a Dr balance flag makes it negative.
  - **Skips:** blank rows, and rows with non-date text and no amounts
    (footers/notes). Processing continues after them.
  - **Row errors:** MISSING_COLUMNS, UNEXPECTED_EXTRA_COLUMNS (filled cells
    beyond the header width: columns may be shifted), INVALID_DATE,
    INVALID_AMOUNT, NEGATIVE_AMOUNT, AMOUNT_TOO_LARGE, NO_AMOUNT,
    BOTH_DEBIT_AND_CREDIT, INVALID_DIRECTION, INVALID_BALANCE,
    MISSING_DESCRIPTION.
  - **Zero valid rows** → `ParseError NO_VALID_TRANSACTIONS` (whole file fails).
  - **Final guard:** every transaction is checked by a strict Zod schema. Bad
    *data* never reaches it (that's a row error); failing it means a bug in
    our code, so it throws and fails the job instead of storing bad values.
- **Verified:** all five bank samples parse with 0 errors and their running
  balances reconcile on every row; the malformed sample yields exactly its 3
  valid rows and 7 specific errors.

## D23 — Background jobs with BullMQ on Redis; Postgres stays the source of truth
- **Decision (user's choice):** BullMQ queue `upload-processing` on the local
  Redis (no password, bound to 127.0.0.1, `noeviction`). The API adds a job
  after an upload is accepted; a separate worker process (`npm run worker`)
  runs `processUpload()` with concurrency 2.
- **Job rules:** `jobId = uploadId` (adding the same upload twice is a no-op);
  3 attempts with exponential backoff for unexpected errors; a `ParseError`
  throws `UnrecoverableError` (no retries: a broken file stays broken).
- **Stages live in Postgres** (`uploads.stage`, `progress`, `error_code`,
  `error_message`, `row_errors`, `attempts`, `started_at`, `finished_at`).
  `GET /uploads/:id` reads only Postgres. Redis is just the to-do list.
- **Recovery:** BullMQ re-runs jobs whose worker died (stalled jobs). A sweep
  at worker start and every 60s re-adds uploads that aren't `completed` or
  `failed` **and haven't changed for 60s** (`updated_at` is refreshed by every
  stage/progress update) — covers Redis restarts (no persistence) and failed
  enqueues. *Amended in 7e:* the first version swept every unfinished upload,
  including ones about to be processed normally; in tests sharing one
  database, a worker picked up another test file's uploads, couldn't find
  their files, and failed them (flaky test, confirmed from logs).
- **Idempotent processing:** `startProcessing` claims only unfinished uploads
  and resets them; saving deletes the upload's earlier rows, inserts the new
  ones and marks `completed` in ONE transaction.
- **Enqueue failure never deletes an accepted file:** the enqueue happens
  after the file is accepted and outside the cleanup `try/catch`; a failure
  is logged and the sweep picks it up.
- **BullMQ 6 specifics:** `ioredis` must be installed separately and passed
  as a ready client in ESM. API connection fails fast
  (`enableOfflineQueue: false`); worker connection uses
  `maxRetriesPerRequest: null` (required by BullMQ).
- **Bug found by tests:** the CSV reader used `.pipe()`, which doesn't forward
  read errors; a missing file made the job wait forever. Fixed by forwarding
  the source stream's error to the parser; regression test added.

## D24 — Duplicate transactions: fingerprint option A, one row per user
- **Decision (user chose option A):** `src/parsing/fingerprint.js` hashes
  `date + direction + amount + bank reference + running balance`; the
  description is added only when there's neither a reference nor a balance;
  otherwise-identical rows within one file get an occurrence number (#1, #2…).
  `transactions` has `UNIQUE (user_id, fingerprint)`; inserts use
  `ON CONFLICT DO NOTHING` and the upload reports `duplicatesSkipped`.
- **Why:** the reference and balance are the bank's own identifiers and differ
  for every real transaction (both ₹20 CHAI POINT payments are kept); leaving
  out the description stops differently-worded exports of the same payment
  from counting twice; the occurrence number keeps two genuine identical
  payments as two, while an overlapping statement still matches them.
- **Verified:** HDFC Sep (54) + the overlap file (42) → 66 stored, 30 skipped;
  another user's identical statement is unaffected.
- **Re-uploading failed files:** the duplicate-file rule is now a partial
  unique index `(user_id, sha256) WHERE stage <> 'failed'`, and
  `findUploadByHash` ignores failed uploads.
- **Migration 007** rebuilt existing transactions (they're derived from the
  kept files): deleted rows, put completed uploads back to `queued`, the
  sweep reprocesses them with fingerprints.

## D25 — Category list and rules-based categorization (layers 1–3, 5)
- **Category list (approved by the user):** 13 expense categories (Food &
  Dining, Groceries, Transport, **Fuel kept separate**, Travel, Shopping,
  Bills & Utilities, Entertainment & Subscriptions, Health, Rent & Housing,
  Investments, Cash Withdrawal, Transfers Out), 3 income (Salary, Interest,
  Money Received) and Uncategorized. Stable `key`s in the `categories` table
  (migration 008) and `src/categorize/categories.js` — a test keeps them equal.
  Users pick from this list; custom categories are not supported yet.
- **Layers, first match wins** (`src/categorize/`):
  1. user corrections — `category_overrides (user_id, merchant_key)`;
  2. type rules — cash (only real withdrawal wordings: SBI's
     "POS ATM PURCH" is a card purchase), salary, interest, investments, rent;
  3. merchant keyword rules;
  4. transfer rules (IMPS/NEFT/UPI credits → Money Received; IMPS/NEFT
     debits and UPI to personal `@ok…` handles → Transfers Out);
  5. otherwise Uncategorized (never a guess).
  Patterns use whole-word matching on the uppercased description and the
  transaction direction.
- **Stored per transaction:** `category`, `category_source`
  (`user`/`rule`/`llm`/`none`), `merchant_key`. Upload progress reports
  `categorizedBy: { user, rule, none }`.
- **Merchant key:** the UPI handle when present (same across banks that
  include it), else the description minus numbers, card masks and banking
  words.
- **Evaluation:** `tests/fixtures/categorization/labels.json` (256 sample
  transactions, labelled from a hand-written table, not from the rules) and
  `npm run eval:categories`. Result: 256/256, 0 wrong, 0 uncategorized —
  **expected, because the rules were written against these samples**; the
  number becomes meaningful once real anonymized rows are added.
- **New stage:** `queued → reading → validating → categorizing → saving →
  completed`. Migration 008 rebuilt existing transactions (same approach as 007).

### D26 — Statement summary and running-balance check (step 7f)
- **What:** A new `summarizing` stage computes, from the categorized
  transactions, `uploads.summary` (jsonb, migration 009):
  `period {from,to}`, `totals {count, debitPaise, creditPaise, netPaise}`,
  `byCategory` (only categories that appear, in list order), `byMonth`
  (`YYYY-MM`, oldest first) and `balance`. Returned by `GET /uploads/:id`
  only (not the list), saved in the same database transaction as `completed`.
- **Scope = the file:** it counts every transaction found in the statement,
  including rows skipped as duplicates of an overlapping upload. Questions
  across statements belong to the dashboard API, which reads the database.
- **Balance check:** each row must satisfy `balance = previous balance ±
  amount`. Only neighbouring rows that both have a balance are compared.
  File order is tried first; the reverse only if it has fewer mismatches
  (`order: oldest_first | newest_first`). `status`: `ok`, `mismatch` (first
  20 mismatches with expected/actual), or `unavailable` (no balances).
  Opening balance = first balance with its own amount undone.
- **A mismatch is a warning, not a failure:** the rows are still saved and
  the upload completes; the user sees which lines don't add up (usually
  the rows that were rejected as row errors). Logged as `warn`.
- **Verified:** all five sample banks reconcile on every row; SBI's computed
  opening balance equals the "Balance as on 1 Sep 2026" printed in its header.
- **Old uploads** are not reprocessed: their `summary` stays NULL (T64).

### D27 — Our own streaming `.xlsx` reader on `sax` (step 7g)
- **What:** `src/parsing/readers/xlsxReader.js` turns the first *visible*
  worksheet into the same `{ line, cells }` rows as the CSV reader, so header
  detection, normalizing, categorizing and the summary are reused unchanged.
  `processUpload` picks the reader by `upload.format`.
- **Why not a library:** the npm `xlsx` (SheetJS) package is frozen at an
  old version with known advisories; ExcelJS is large for reading one grid.
  An `.xlsx` is a zip (already opened safely by `yauzl` in the gate) of XML;
  reading cells needs ~300 lines on top of `sax` (zero dependencies,
  maintained), and every rule is visible and tested.
- **How:** `workbook.xml` + its rels → the sheet's path (must stay inside the
  zip); `sharedStrings.xml` → text table (phonetic `<rPh>` ignored);
  `styles.xml` → which cell styles are dates (built-in ids + custom codes
  containing d/y); the sheet XML is **streamed** and rows are yielded per
  chunk. Namespace prefixes (`x:row`) are stripped.
- **Cells become what a CSV export would show:** date serials →
  `DD/MM/YYYY` (1900 and 1904 systems), numbers rounded to Excel's 15
  significant digits (`654.75000000000011` → `654.75`), booleans → TRUE/FALSE.
  Line numbers are Excel row numbers, so errors point at the row the user sees.
- **Strict:** strict XML, any `DOCTYPE` refused (no entity expansion at all),
  invalid UTF-8 refused, rows must go down the sheet, values beyond column
  200 or cells over 64 KB refused → `MALFORMED_XLSX`; no visible worksheet →
  `NO_WORKSHEET`. Unexpected errors are NOT reported as a broken file: they
  are logged and retried like any internal error.
- **Fingerprint fix:** Excel stores all-digit references as numbers, losing
  leading zeros (`0000006266119255` → `6266119255`). The fingerprint now
  compares all-digit references without leading zeros (the stored reference
  is unchanged), so a statement's CSV and `.xlsx` dedupe against each other.
- **Verified:** the five bank CSVs saved as `.xlsx` by LibreOffice (Indian
  locale) give identical transactions and fingerprints to the CSVs.

### D28 — Large files: one streaming pass, flat memory (step 7i)
- **Measured first:** the 7d–7g pipeline held every row in memory (three
  copies); 200k rows peaked at **425 MB** — too much for a 1 GB EC2 instance
  running two jobs at once.
- **Now:** `processUpload` reads the header ("reading"), then makes ONE
  streaming pass ("importing"): each row is checked; valid rows are collected
  into batches of 5,000, categorized, fingerprinted, added to the summary and
  inserted; then released. Nothing grows with the file except the
  fingerprint occurrence map (one short key per transaction) and at most
  100 kept row errors (all are counted).
- **Building blocks made incremental:** `createBalanceCheck()` (checks both
  reading orders side by side), `createSummary()`, `createFingerprinter()`.
  The array versions (`summarize`, `checkRunningBalance`, `addFingerprints`,
  `normalizeRows`) remain for tests and scripts.
- **Stages change** (migration 010): `queued → reading → importing → saving →
  completed | failed`. Validating, categorizing and summarizing now happen
  together row by row, so separate stages would be untrue. Instead
  `progress.percent` (bytes read / file size; for .xlsx, of the sheet XML)
  and live counts (`rowsRead`, `transactionsFound`, `transactionsSaved`,
  `rowErrors`), written at most every 500 ms.
- **Still all-or-nothing:** everything is inside one database transaction. A
  file that breaks on its last line after thousands of rows were inserted
  leaves nothing behind (tested).
- **Results** (this dev machine → Supabase over the internet):
  - CSV reader alone: 76 MB peak for 20k and for 200k rows (flat).
  - 200k-row CSV (23.6 MB) end to end: 80–100 s, balance check ok; peak
    337–374 MB for ONE process holding the test client (the whole file, more
    than once, in memory), the API and the worker together.
  - Time is dominated by sending rows to the database (batches of 5,000:
    12.9 s for 20k rows vs 18.6 s with 1,000). On EC2 in the database's
    region it should be much faster; to be re-measured there.
  - 20k-row .xlsx: read in 0.6 s, 93 MB peak.
- **Size limits unchanged:** 10 MB upload ≈ 85k CSV rows; the .xlsx gate's
  50 MB uncompressed limit ≈ 100k rows. Memory no longer depends on them, so
  raising `UPLOAD_MAX_BYTES` is now only a time question (T72).

### D29 — Transactions API and corrections
- **Endpoints** (all behind `requireAuth`, all scoped to `req.user.id`):
  - `GET /transactions?from&to&category&direction&uploadId&q&sort&limit&offset`
    → `{ transactions, pagination: { limit, offset, hasMore } }` (limit ≤ 200,
    sort `date_desc` default / `date_asc` / `amount_desc` / `amount_asc`).
  - `PATCH /transactions/:id { category, applyToMerchant = true }`
    → `{ transaction, rule, updatedCount }`.
  - `GET /categories` (the fixed list), `GET /categories/rules`,
    `DELETE /categories/rules/:id`.
- **One filter definition** (`schemas/transactions.js` + `filterSql()`) is used
  by the list, the dashboard and the exports, so what you see, what is
  charted and what you download are always the same rows. Queries are
  `strictObject`: a misspelt parameter is a 400, not silently ignored. Every
  value is a SQL parameter; `q` escapes `%` and `_`.
- **A correction with `applyToMerchant`** (the default) does three things in
  one DB transaction: upsert the merchant's rule in `category_overrides`
  (used by every future upload — layer 1, D25), re-label ALL the user's
  transactions with that merchant key, and return the changed row. Without
  it (or when the row has no merchant key) only that row changes. Changed
  rows get `categorySource: "user"`. `SELECT … FOR UPDATE` serialises two
  corrections of the same row.
- **Deleting a rule** stops it applying to future uploads; existing rows
  keep their category (T76).
- **Upload summaries stay a snapshot** of the import (T66 decided): the
  dashboard is the live view.
- **bigint as numbers:** `pool.js` parses int8 into a JS number and throws
  if it isn't a safe integer, so amounts are numbers in JSON and can never
  be silently rounded.
- **404 for everything not yours** (bad id, missing, someone else's), as for
  uploads (D17).

### D30 — Dashboard API: one endpoint, live aggregates
- **`GET /dashboard?<same filters as the list>&granularity=day|week|month`**
  (default month) →
  - `period { from, to }`: the dates the matching rows actually cover;
  - `totals { count, debitPaise, creditPaise, netPaise }`;
  - `byCategory`: with `name` and `kind`, only categories present, list order;
  - `timeline`: one point per day / week (Monday, like Postgres
    `date_trunc`) / month **with gaps filled by zeros**, each with
    `spendingByCategory` (money out per category) for a stacked chart;
  - `topMerchants`: the 10 merchants with the most money out (with their
    most common category).
- **Live, from `transactions`:** four aggregate queries run in parallel
  with the shared `filterSql`, so a chart always matches the list behind it
  (tested: totals equal sums over the list for five different filters).
  Corrections show up immediately.
- **Limit:** more than 1,000 points → 400 `TOO_MANY_PERIODS` (choose a
  coarser grouping). The period list is built from the data's actual range,
  never from a requested range, and stops one past the limit.
- **Money in/out by direction**, not by category kind: transfers to your own
  accounts count as money out (T80).

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
- [ ] **Redis on EC2:** `bind 127.0.0.1`, `protected-mode yes`,
      `maxmemory-policy noeviction`; port 6379 closed in the security group (T55).
- [ ] **pm2 runs two processes:** `npm start` (API) and `npm run worker`.

## Open questions

- **Auth transport:** httpOnly cookie (needs `SameSite=None; Secure` across
  domains) vs `Authorization: Bearer` token. Decide when building auth.
