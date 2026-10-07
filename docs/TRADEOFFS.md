# Trade-offs

Every shortcut or limitation we are knowingly accepting, in one place.
`DECISIONS.md` says *what we chose and why*; this file says *what it costs us,
when that cost starts to hurt, and how we'd fix it*.

Each entry:
- **We accept:** the limitation, stated plainly.
- **Hurts when:** the situation where it becomes a real problem.
- **Fix / upgrade path:** what we'd change, so it's a plan rather than a surprise.

Status tags: **Active** (in the system now) · **Dev-only** (must change before
deploying; also tracked in DECISIONS.md → "Revisit before deploying") ·
**Planned** (coming with the next step).

---

## Architecture & hosting

### T1 — Single EC2 instance · Active · (D6)
- **We accept:** One server runs the whole backend. If it crashes, reboots or
  is being updated, the API is down. We also own OS patching, HTTPS and restarts.
- **Hurts when:** Uptime matters, or traffic outgrows one machine.
- **Fix:** pm2 for auto-restart now; later a load balancer + 2+ instances (which
  also forces the rate limiter and any in-memory state into Redis — see T9).

### T2 — Frontend and backend hosted separately · Active · (D2)
- **We accept:** Two deployments, two sets of env vars to keep in sync (API URL
  on one side, allowed origin on the other). Browsers treat them as different
  sites, so we must configure CORS and pick cross-site-safe auth.
- **Hurts when:** A URL changes in one place but not the other → "CORS error"
  or login silently failing.
- **Fix:** Document both values in `.env.example` files; or later serve both
  under one domain (e.g. `/api` proxied by nginx) to remove CORS entirely.

### T3 — Plain JavaScript, no TypeScript · Active · (D1)
- **We accept:** No compile-time checks. Typos in property names or wrong
  argument types only show up when the code runs.
- **Hurts when:** The codebase grows and refactors touch many files.
- **Fix:** Zod at the edges (already), tests on critical paths, and optionally
  JSDoc type comments + `// @ts-check` without switching languages.

### T4 — Layered backend (middleware → routes → services → db) · Active · (D5)
- **We accept:** More files and indirection than a single-file Express app.
- **Hurts when:** Rarely; mostly it feels like overhead on tiny features.
- **Fix:** None needed — this is the price of being able to find bugs fast.

## Database

### T5 — Direct (IPv6-only) Supabase connection · Dev-only · (D6)
- **We accept:** Local dev uses the direct host, which only resolves to IPv6.
- **Hurts when:** Deploying to EC2 without IPv6 enabled → connection fails.
- **Fix:** Enable IPv6 on the EC2 VPC/subnet, or switch `DATABASE_URL` to the
  Supabase pooler string. Code doesn't change.

### T6 — SSL without certificate verification · Dev-only (fixed when DATABASE_CA_CERT is set, D37) · (applies to `pool.js` too)
- **We accept:** `ssl: { rejectUnauthorized: false }` — traffic is encrypted but
  we don't verify we're talking to the real Supabase server.
- **Hurts when:** Someone on the network path impersonates the DB server
  (man-in-the-middle) — they could read credentials and data.
- **Fix:** Done in D37: set `DATABASE_CA_CERT` (required in production).

### T18 — Hand-written migration runner · Active · (D10)
- **We accept:**
  - *No "down" migrations:* there's no automatic undo; reverting means writing
    a new migration.
  - *No lock:* if two people/servers run `npm run migrate` at the same moment,
    both could try the same migration (one would fail on the transaction).
  - *Edits aren't detected:* changing an already-applied `.sql` file does
    nothing, silently. No checksum.
- **Hurts when:** Multiple deployers, automated deploys running migrate on
  several servers, or someone "fixes" an old migration file.
- **Fix:** Add `pg_advisory_lock` + a checksum column, or switch to
  `node-pg-migrate` / `dbmate`.

### T19 — UUID primary keys · Active · (D11)
- **We accept:** 16 bytes per id (vs 8 for bigint) and random insert order,
  which makes indexes a bit larger and slower to write; ids are long to type
  when debugging.
- **Hurts when:** Tables reach many millions of rows.
- **Fix:** UUIDv7 (time-ordered) when Postgres 18 is available, or bigint
  internally with UUID only in public URLs.

### T20 — Backend uses the `postgres` superuser role · Superseded by D38 once `npm run db:app-role` has run
- **We accept:** The app connects as `postgres`, which bypasses RLS and can do
  anything, including dropping tables.
- **Hurts when:** A SQL injection bug or a leaked `DATABASE_URL` → full
  control of the database.
- **Fix:** Done in D38: the app connects as `expense_app` (rows only, no
  DDL, no RLS bypass); `postgres` only runs migrations.

### T21 — Tests run against the real Supabase project · Active
- **We accept:** Database tests use the same project as development (user's
  choice over a separate test project). Test users use `@example.test`
  emails and are deleted after each test file. Migrations themselves are still
  only verified by hand.
- **Hurts when:** A test crashes before cleanup (leftover test rows), a buggy
  cleanup query deletes real data, tests run in parallel with real usage, or
  tests become slow because every run goes over the network (~3s per signup).
  `npm test` also needs `.env` and internet access. Network-drop tests use
  short polling timeouts (3s), so a very slow machine could make them flaky.
- **Fix:** A separate Supabase project or local Postgres in Docker just for
  tests; run each test inside a transaction that's rolled back.

## Auth

### T7 — We build auth ourselves instead of Supabase Auth · Active · (D3)
- **We accept:** Password hashing, sessions/tokens, expiry and logout are our
  code and our responsibility to get right.
- **Hurts when:** A mistake here (weak hashing, token leak) is a real breach.
- **Fix:** Use proven libraries (bcrypt, well-reviewed JWT/session libs), strict
  rate limits on `/auth`, and tests for every auth path.

### T22 — Access tokens can't be revoked early · Active · (D12)
- **We accept:** A JWT access token stays valid until it expires (15 min),
  even after logout or a password change. Only the refresh token is revocable.
- **Hurts when:** An access token is stolen — the attacker keeps access for up
  to 15 minutes.
- **Fix:** Shorter TTL (more refresh traffic), or a DB/Redis denylist of
  revoked token IDs (which brings back the per-request lookup we avoided).

### T23 — Refresh cookie needs frontend and backend on the same site · Active · (D12)
- **We accept:** The refresh cookie uses `SameSite=Lax`, so it only works when
  frontend and backend count as the same site. `myapp.vercel.app` + an EC2
  domain are different sites; browsers (Safari by default, others
  increasingly) block cookies across sites.
- **Hurts when:** Deploying to two unrelated domains → refresh silently fails,
  users get logged out every 15 minutes.
- **Fix:** Custom domain (`app.example.com` + `api.example.com`), or proxy
  `/api/*` through the frontend host (e.g. Vercel rewrites) so the browser
  sees one site. Decide at deployment.

### T26 — Minimal JWT: one shared secret, no issuer/audience · Active · (D12)
- **We accept:** HS256 means the same secret signs and verifies, so anything
  that can verify tokens can also create them. Tokens carry no `iss`/`aud`, so
  a token from another app using the same secret would be accepted.
- **Hurts when:** A second service needs to verify our tokens (it would need
  our signing secret), or the secret leaks: every token can be forged until
  it's rotated, and rotating it logs everyone out.
- **Fix:** RS256/EdDSA (private key signs, public key verifies) and set
  `issuer`/`audience`, if more services ever verify tokens.

### T27 — Login doesn't log failed attempts · Active
- **We accept:** Failed logins only appear as a generic 401 line in the
  request log; no per-account counter or lockout.
- **Hurts when:** Someone guesses passwords slowly against one account.
- **Fix:** Pending rate limiter on `/auth`; later, per-account failure
  counter with temporary lockout or CAPTCHA.

### T28 — Two simultaneous refreshes log the user out · Active · (D12)
- **We accept:** If two requests refresh with the same token at the same time
  (two open tabs, or the frontend firing twice), the DB lock lets one win;
  the other sees an already-revoked token, which is indistinguishable from a
  stolen token being replayed, so the whole session is revoked. Verified:
  tab A → 200, tab B → 401 `REFRESH_TOKEN_REUSED`, then tab A's new token → 401.
- **Hurts when:** Users with several tabs open get randomly logged out
  when the access token expires.
- **Fix:** Frontend: one shared in-flight refresh promise per tab, and the
  Web Locks API / BroadcastChannel across tabs. Server alternative: a short
  grace period (~10s) where the just-rotated token returns the same new token
  instead of triggering reuse detection, at the cost of a small replay window.

### T29 — Old refresh-token rows are never deleted · Active
- **We accept:** Every login and every refresh (≈ every 15 min of activity)
  adds a row. Revoked and expired rows stay forever.
- **Hurts when:** The table grows large over months; Supabase free tier has
  a 500 MB database limit.
- **Fix:** A scheduled cleanup (`DELETE … WHERE expires_at < now() - interval
  '1 day'`), e.g. a cron job on EC2 or Supabase's `pg_cron`.

### T30 — Refresh cookie is `Secure` only in production · Active
- **We accept:** Locally the cookie can travel over plain HTTP so
  `http://localhost` works. `Secure` depends on `NODE_ENV=production`.
- **Hurts when:** EC2 runs without `NODE_ENV=production` → the cookie could be
  sent over plain HTTP and read by anyone on the network path.
- **Fix:** Listed in DECISIONS.md → "Revisit before deploying"; pm2 config
  will set it.

### T31 — "Reused" can't be told apart from "already logged out" · Active
- **We accept:** A token revoked by logout and a token revoked by rotation look
  the same, so presenting a logged-out token returns `REFRESH_TOKEN_REUSED`
  (and harmlessly re-revokes an already-dead family).
- **Hurts when:** Reading logs: some "reuse" entries are just stale cookies,
  not attacks.
- **Fix:** Add a `revoked_reason` column (`rotated` / `logout` / `reuse`).

### T8 — Password limited to 72 bytes · Active · (D8)
- **We accept:** Passwords longer than 72 **bytes** are rejected, because bcrypt
  ignores everything after byte 72. The Zod rule counts bytes (a 28-character
  Hindi password is 84 bytes and is rejected). An earlier version counted
  characters, which let such passwords through and bcrypt silently cut them.
- **Hurts when:** A user with a very long passphrase (or many multi-byte
  characters, e.g. emoji/Hindi script) hits the limit.
- **Fix:** Switch to argon2 (no such limit), or pre-hash before bcrypt.

### T24 — Signup reveals whether an email is registered · Active
- **We accept:** Signing up with an existing email returns 409 `EMAIL_TAKEN`,
  so anyone can check whether a given email has an account here.
- **Hurts when:** Attackers build lists of valid accounts to target with
  password guessing or phishing.
- **Fix:** Email verification ("if this email is new, check your inbox" for
  every signup), plus the pending rate limiter on `/auth`.

### T25 — bcrypt cost 12 · Active
- **We accept:** Hashing takes ~250ms of CPU per signup/login on purpose
  (it's what makes stolen hashes slow to crack), and it blocks a thread from
  libuv's small pool while running.
- **Hurts when:** Many logins at once on a small EC2 instance → slow logins;
  an attacker spamming `/auth/login` can tie up the CPU.
- **Fix:** Rate limit `/auth` (pending); scale the instance; tune the cost.

## Rate limiting

### T9 — Fixed-window, in-memory rate limiter · Active · (D36)
- **We accept:**
  - *Fixed window:* a client can send up to **2× the limit** right at the
    boundary (the end of one window plus the start of the next).
  - *In memory:* counts live in the Node process. They **reset whenever the
    server restarts**, and they'd be **wrong with more than one server**
    (each server counts separately, so the real limit becomes N × max).
- **Hurts when:** Someone deliberately times bursts at window edges, we
  restart often, or we scale beyond one EC2 instance (T1).
- **Fix:** Sliding-window or token-bucket algorithm for smoother limits; Redis
  as a shared store, or `express-rate-limit` with a Redis store.

### T10 — Client IP depends on correct `trust proxy` · Active · (D35)
- **We accept:** Behind nginx, the real client IP comes from the
  `X-Forwarded-For` header, which we trust only from loopback (nginx on the
  same machine).
- **Hurts when:** The proxy setup changes (e.g. an AWS load balancer in front)
  and the setting isn't updated → everyone shares one limit, or clients can
  spoof their IP and dodge limits.
- **Fix:** Update `trust proxy` whenever the network path in front of the app changes.

## Uploads

### T32 — Uploads restart from zero after a network drop · Active · (D14)
- **We accept:** One streaming request per file; if the connection drops,
  the partial file is discarded and the whole file is sent again.
- **Hurts when:** Files are large (tens of MB+) on unreliable networks.
- **Fix (scheduled):** Resumable uploads with the tus protocol
  (`@tus/server` + `tus-js-client`), plus a cleanup job for abandoned
  partial uploads. Decided for a later stage — see TASKS.md → Pending.

### T33 — Legacy `.xls` files are rejected · Active · (D15)
- **We accept:** Users whose bank only exports `.xls` (or HTML disguised as
  `.xls`) must re-save it as `.xlsx` or CSV first.
- **Hurts when:** Less technical users don't know how to convert the file.
- **Fix:** Add SheetJS from its official CDN (pinned version + checksum),
  parsed in a worker thread with a timeout and memory cap.

### T34 — Raw statements are kept on disk indefinitely · Active · (D16)
- **We accept:** Every accepted bank statement stays in `storage/files/`
  forever (until a retention policy is decided), unencrypted beyond the disk
  itself. Earlier plan was "delete after parsing"; changed by the user.
- **Hurts when:** Someone gains access to the server or a backup → years of
  users' statements; the disk fills up; privacy laws (e.g. India's DPDP Act)
  expect data to be kept no longer than needed.
- **Fix:** Decide a retention policy (e.g. delete N days after parsing, or
  let users delete their own files); encrypt the EBS volume; disk alerts.

### T39 — Deleting a user leaves their files on disk · Active · (D16)
- **We accept:** `ON DELETE CASCADE` removes the user's `uploads` and
  `stored_files` rows, but the database can't delete files on disk, so the
  files stay with nothing pointing to them.
- **Hurts when:** Account deletion is built — a "deleted" user's statements
  would still exist.
- **Fix:** Account deletion reads the user's `stored_files` paths and
  deletes the files before (or after) deleting the rows; plus the orphan
  cleanup job from T35.

### T40 — `user_id` stored in both `uploads` and `stored_files` · Active · (D16)
- **We accept:** The owner is recorded twice (as requested, so the path is
  mapped directly to the user).
- **Hurts when:** The two copies disagree.
- **Fix:** Already guarded: the composite foreign key makes a disagreeing
  row impossible (tested).

### T35 — A crash at the wrong moment can orphan a file · Active · (D14)
- **We accept:** The file is moved into `storage/files/` and then the DB row
  is inserted. If the process dies between those two steps, the file stays
  on disk with no row pointing to it. (Every *handled* error deletes it.)
- **Hurts when:** Rarely; slowly wastes disk space over many crashes.
- **Fix:** A cleanup job that deletes files in `files/` with no matching row,
  and anything in `tmp/` older than an hour.

### T36 — Oversized bodies without a declared size are read to the end · Active · (D14)
- **We accept:** If a client doesn't send `Content-Length` (chunked upload),
  busboy stops *saving* at 10 MB but Node still reads and discards the rest
  of the body so it can send a clean 413.
- **Hurts when:** Someone streams gigabytes at the endpoint to waste
  bandwidth and CPU.
- **Fix:** nginx `client_max_body_size` (in the deploy checklist) cuts these
  off before they reach Node; the pending rate limiter limits repeats.

### T37 — Duplicate-file check is exact bytes only · Active · (D14) — row-level dedupe now covers overlaps (D24)
- **We accept:** Same SHA-256 = duplicate. The same statement re-downloaded
  later (e.g. with a different "generated on" line), or an overlapping
  statement, has different bytes and is accepted as a new upload.
- **Hurts when:** Overlapping transactions would be counted twice.
- **Fix:** Planned in parsing: row-level dedupe (`edge_hdfc_overlap_*` sample).

### T38 — An unauthenticated upload's body is still read and discarded · Active
- **We accept:** `requireAuth` rejects before any byte is *stored*, but
  Node still reads the rest of the incoming body to keep the connection
  usable.
- **Hurts when:** Bandwidth abuse by unauthenticated clients.
- **Fix:** Same as T36 (nginx size cap, rate limiter); optionally send
  `Connection: close` on 401s for `/uploads`.

### T41 — Offset pagination for the uploads list · Active · (D17)
- **We accept:** `LIMIT/OFFSET`. Postgres still walks past all skipped rows,
  and if a new upload arrives between page 1 and page 2, every row shifts by
  one, so one upload appears on both pages.
- **Hurts when:** A user has thousands of uploads, or uploads while paging.
  (Unlikely: a user uploads a few statements a month.)
- **Fix:** Keyset/cursor pagination: `WHERE (created_at, id) < ($cursor)`
  with an opaque `nextCursor` in the response.

### T42 — The .xlsx gate decompresses every upload once · Active · (D15)
- **We accept:** Proving sizes means inflating up to 50 MB per `.xlsx`
  upload (and parsing will inflate it again). Cost: up to ~0.5s of CPU.
- **Hurts when:** Many large workbooks arrive at once on a small EC2 instance.
- **Fix:** Pending rate limiter; lower the 50 MB cap; or merge the gate and
  the parser into one pass once parsing exists (decompress once, with the
  same caps).

### T43 — Zip-bomb limits are fixed guesses · Active · (D15)
- **We accept:** 200 entries, 50 MB expanded, 100:1 ratio for entries over
  1 MB. A legitimate but unusual workbook (huge, very repetitive sheet)
  could be rejected.
- **Hurts when:** A real bank export trips a limit → `SUSPICIOUS_COMPRESSION`
  or `XLSX_TOO_LARGE` for a genuine file.
- **Fix:** Tune with real exports; limits live in `XLSX_LIMITS`.

## Background processing & categorization

### T44 — ~~In-process job runner~~ · Superseded by D23 (BullMQ)

### T55 — Redis has no password · Dev-only (and EC2 with care) · (D23)
- **We accept:** Anyone who can reach Redis's port can read and delete jobs
  or run any Redis command (user's choice). Safe locally because Redis only
  listens on 127.0.0.1.
- **Hurts when:** Redis is ever reachable from outside the machine (a wrong
  `bind`, an open security group): a known, actively scanned attack target.
- **Fix:** On EC2 keep `bind 127.0.0.1` + `protected-mode yes` and never open
  6379; if Redis moves to its own server, add a password (`requirepass`/ACL)
  and TLS.

### T56 — Redis doesn't persist the queue · Active · (D23)
- **We accept:** `appendonly no` — a Redis restart loses waiting jobs.
- **Hurts when:** Only as a delay: the sweep re-adds an upload once it has
  been untouched for 60s, so recovery takes 1–2 minutes. Job history in
  Redis is lost.
- **Fix:** Enable AOF if job history ever matters.

### T57 — One more service to run and monitor · Active · (D23)
- **We accept:** Uploads are accepted while Redis or the worker is down, but
  stay `queued` until both are back. Deploys now involve two processes.
- **Hurts when:** The worker crashes unnoticed → uploads queue up silently.
- **Fix:** pm2 auto-restart; later, a `/health` check that reports queue
  depth and the oldest `queued` upload's age (metrics, pending).

### T58 — Whole statement held in memory while parsing · Active · (D23)
- **We accept:** Transactions are collected in an array before saving
  (≈ 10 MB file → tens of MB of objects).
- **Hurts when:** Many large files at once on a small instance.
- **Fix:** 7i: save in batches while streaming (needs a "replace previous
  attempt" strategy that still keeps the all-or-nothing completed state).

### T45 — Polling instead of push · Planned · (D18)
- **We accept:** The frontend asks every ~2s. Up to 2s delay before it sees
  a stage change, and many requests for a long job.
- **Hurts when:** Many users processing at once (lots of small requests).
- **Fix:** Server-Sent Events (`GET /uploads/:id/events`) pushing each stage.

### T46 — Partial imports · Planned · (D18)
- **We accept:** Bad rows are skipped and reported; the rest are saved.
- **Hurts when:** A skipped row was real money (e.g. a misparsed date), so
  totals are quietly off unless the user reads the "skipped" report.
- **Fix:** Show skipped rows prominently in the summary; let users fix and
  re-import them.

### T47 — LLM categorization sends merchant text to a third party · Planned · (D19)
- **We accept (when enabled):** Merchant descriptions leave our server for
  an external API. Results can vary between runs; costs money per call;
  adds latency; the API can be down.
- **Hurts when:** Privacy expectations (financial data), cost at scale, or
  inconsistent categories for similar merchants.
- **Fix/guards:** Off by default; redact before sending; cache per merchant
  so each is asked once; only accept our own category names; rules and user
  corrections always win; fall back to `Uncategorized`.

### T48 — CSV reader assumes commas · Active · (D20)
- **We accept:** Only `,` is treated as the separator. Exports using `;`
  (common in European locales) or tabs would read as one cell per row.
- **Hurts when:** A bank or a spreadsheet app exports with `;` or tabs —
  the file would later fail as `UNRECOGNIZED_FORMAT`, not crash.
- **Fix:** Detect the separator from the first lines (count `,` `;` `\t`)
  before parsing.

### T49 — Stray quotes are tolerated · Active · (D20)
- **We accept:** `relax_quotes` keeps a `"` that appears mid-cell as a
  literal character instead of failing the file.
- **Hurts when:** A genuinely broken file is read "successfully" with odd
  cells; later stages must then catch the nonsense (bad dates/amounts).
- **Fix:** None planned; real bank narrations do contain stray quotes
  (e.g. `ABC"S STORE`), and later per-row validation catches bad values.

### T50 — Alias-based header matching can misfire · Active · (D21)
- **We accept:** Matching is by exact normalized name. A bank with an
  unlisted heading ("Txn Particulars", "Withdrawal (Dr)") is rejected as
  UNRECOGNIZED_FORMAT; a heading reused with a different meaning would be
  mapped wrongly.
- **Hurts when:** New banks or a bank changes its export format.
- **Fix:** Add aliases as real exports arrive (one line each); later, a
  "map your columns" screen for unknown formats.

### T51 — The bank itself is not identified · Active · (D21)
- **We accept:** We know the column layout, not which bank it came from
  (preamble is ignored).
- **Hurts when:** The summary or dashboard wants to show "HDFC ••123".
- **Fix:** Look for bank names/IFSC prefixes (HDFC, SBIN, ICIC, UTIB, KKBK)
  in the preamble when the summary step needs it.

### T52 — Dates are always read day-first · Active · (D22)
- **We accept:** `03/04/26` is 3 April, never March 4. Two-digit years mean
  20xx.
- **Hurts when:** A statement from a non-Indian bank (US: month-first).
- **Fix:** Detect from the file (a day > 12 in the first column proves the
  order) or a per-format setting.

### T53 — Footers are skipped, then processing continues · Active · (D22)
- **We accept:** A row with non-date text and no amounts is skipped as a
  note/footer, and we keep reading. Anything after it that looks like a
  broken transaction becomes a row error rather than being silently ignored.
- **Hurts when:** A bank adds a summary table after the transactions (e.g.
  "Opening Balance, Debits, Credits" with numbers) → spurious row errors.
- **Fix:** Stop at a known footer marker per format, once such exports exist.

### T54 — A broken value date is ignored, not an error · Active · (D22)
- **We accept:** If the (optional) value date can't be read, it's stored as
  null and the row is kept; only the transaction date is required.
- **Hurts when:** Rarely; value date is informational.
- **Fix:** None planned.

### T59 — A shared transaction belongs to whichever upload saved it first · Active · (D24)
- **We accept:** When statements overlap, each shared row is stored once,
  owned by the upload that inserted it first. The later upload just counts
  it as a duplicate.
- **Hurts when:** "Delete this upload" is built: deleting the first upload
  would remove rows the overlapping upload also contained.
- **Fix:** On upload delete, reprocess the user's other uploads (or keep a
  link table upload ↔ transaction so a row is removed only when no upload
  still contains it).

### T60 — The fingerprint trusts the bank's reference and balance · Active · (D24)
- **We accept:** Two different transactions with the same date, direction,
  amount, reference and balance would be treated as one.
- **Hurts when:** A bank reuses or blanks references *and* omits balances —
  then we fall back to description + occurrence number, which can merge two
  rows only if they're identical in every field anyway.
- **Fix:** None needed for the five supported formats (verified: every
  sample row has a unique fingerprint).

### T61 — Keyword rules only know the merchants we listed · Active · (D25)
- **We accept:** A merchant not in the lists (a local restaurant, a new app)
  is Uncategorized. Rules were tuned on synthetic samples, so the 100% score
  overstates real-world accuracy.
- **Hurts when:** Real statements with many small local merchants → a large
  Uncategorized share on the dashboard.
- **Fix:** Add real anonymized rows to the evaluation set and extend the
  lists; user corrections; the planned LLM layer (7h) for the leftovers.

### T62 — Merchant keys differ when a bank omits the UPI handle · Active · (D25)
- **We accept:** Kotak writes "UPI/SWIGGY/…" without a handle, so its key is
  `SWIGGY`, while other banks give `swiggy@icici`. A correction made on one
  doesn't apply to the other.
- **Hurts when:** A user with accounts at Kotak and another bank corrects a
  merchant and it "doesn't stick" on the other statement.
- **Fix:** Store the cleaned name alongside the handle and match a
  correction against either.

### T63 — Fixed category list · Active · (D25)
- **We accept:** Users can't add their own categories (e.g. "Kids",
  "Pets"); corrections choose from the 17 built-in ones.
- **Hurts when:** A user's budgeting needs a category we don't have.
- **Fix:** A per-user `custom_categories` table referenced alongside the
  built-in keys.

### T64 — Uploads completed before 7f have no summary · Dev-only · (D26)
- **We accept:** Migration 009 doesn't reprocess old uploads; their
  `summary` is NULL.
- **Hurts when:** Only on dev data processed before 7f.
- **Fix:** Re-upload, or set those uploads back to `queued` and let the
  sweeper pick them up.

### T65 — A balance mismatch only warns · Active · (D26)
- **We accept:** A statement whose running balance doesn't add up is still
  saved and marked `completed`, with `summary.balance.status = 'mismatch'`.
- **Hurts when:** A misread amount (not just a missing row) slips into the
  dashboard totals while the user ignores the warning.
- **Fix:** Have the frontend show the warning prominently with the lines; if
  misreads ever happen in practice, fail the upload when mismatches are not
  explained by row errors.

### T66 — The summary is fixed at upload time · Active (decided in D29) · (D26)
- **We accept:** `byCategory` is a snapshot. If the user later corrects a
  category, the stored summary still shows the old split. Decided: the
  upload summary is the *import report*; the dashboard is the live view.
- **Hurts when:** The upload page and the dashboard disagree after a correction.
- **Fix:** The frontend labels it "at import"; or compute `byCategory` on read.

### T67 — Only the first visible worksheet is read · Active · (D27)
- **We accept:** Other sheets are ignored, even if they hold more transactions.
- **Hurts when:** A bank puts each month (or a cover page) on its own sheet.
- **Fix:** Read every visible sheet whose header is recognised, or let the
  user pick the sheet.

### T68 — Shared strings are held in memory · Active · (D27)
- **We accept:** The whole text table is loaded before the sheet streams
  (bounded by the gate: ≤ 50 MB uncompressed).
- **Hurts when:** A very large workbook with mostly unique text uses a lot of
  worker memory.
- **Fix:** Measured in 7i: a 20k-row workbook peaks at 93 MB; the gate's
  50 MB uncompressed limit caps a workbook at ~100k rows. If that ever
  matters, read sharedStrings into a temporary file instead.

### T69 — Excel's 15-digit limit on numeric references · Active · (D27)
- **We accept:** A reference stored by Excel as a number keeps only 15
  significant digits; a 16+ digit reference is already changed in the file.
- **Hurts when:** The CSV and the `.xlsx` of the same statement have such
  references: their fingerprints differ and those rows are saved twice.
- **Fix:** Banks' own `.xlsx` exports usually store references as text; if
  not, compare such rows on date + amount + balance only.

### T70 — Fingerprints saved before 7g used references with leading zeros · Dev-only · (D27)
- **We accept:** Rows saved earlier keep their old fingerprint.
- **Hurts when:** Re-importing an overlapping statement on dev data saved
  before 7g could store some rows twice.
- **Fix:** Reprocess old uploads (set them to `queued`), or start dev data fresh.

### T71 — One long database transaction per import · Active · (D28)
- **We accept:** A 200k-row import keeps one transaction (and one pool
  connection) open for its whole duration (~1–2 minutes here).
- **Hurts when:** Many huge imports run at once (connections tied up), or a
  long transaction delays Postgres housekeeping (vacuum).
- **Fix:** Import into a staging table in committed batches, then swap in
  one short transaction at the end.

### T72 — Large uploads take time, and the upload limit stays at 10 MB · Active · (D28)
- **We accept:** ~85k CSV rows per file; a big file takes a minute or more to
  import (progress is shown).
- **Hurts when:** Someone has a bigger export (e.g. many years of a business
  account).
- **Fix:** Raise `UPLOAD_MAX_BYTES` (memory is flat now), together with
  nginx `client_max_body_size`; resumable uploads (tus) for slow networks.

### T73 — Fewer, coarser stages · Active · (D28)
- **We accept:** The user sees reading → importing (with %) → saving instead
  of validating / categorizing / summarizing as separate steps.
- **Hurts when:** Someone wants to know exactly which kind of work is running.
- **Fix:** Counters in `progress` already say what has happened so far.

### T74 — One unexplained crash in the 200k measurement · Active · (D28)
- **We accept:** The first of seven 200k-row runs exited with an error whose
  message was cut off by my own `tail`; six reruns with full logs completed.
- **Hurts when:** It's a real bug that happens under load.
- **Fix:** Re-run the measurement on EC2 with full logs; pm2 restarts the
  worker and the sweep re-queues the upload in the meantime.
- **Likely cause found (2026-10-07):** the direct Supabase host is IPv6-only
  and connections from the dev machine time out intermittently (seen three
  times: a signup 500, and the worker crashing at startup because the first
  sweep's error wasn't caught — now fixed, it's logged and retried). The
  pooler connection string (IPv4) is the fix; it's on the deploy checklist.

### T75 — OFFSET pagination for the transaction list · Active · (D29)
- **We accept:** Page N makes Postgres skip N×limit rows (offset ≤ 100,000);
  a row added between page loads can shift a row onto the next page.
- **Hurts when:** Someone pages very deep, or imports while paging.
- **Fix:** Keyset ("after this row") pagination like the export uses.

### T76 — Deleting a rule doesn't undo what it did · Active · (D29)
- **We accept:** Rows re-labelled by a rule keep that category after the
  rule is deleted (they still show `categorySource: "user"`).
- **Hurts when:** The user expects "delete rule" to restore the automatic
  categories.
- **Fix:** Re-run the rules for that merchant's rows on delete (store the
  rule-based category alongside the user's).

### T77 — A merchant-wide correction overwrites single-row corrections · Active · (D29)
- **We accept:** "Always put SWIGGY in Travel" re-labels every SWIGGY row,
  including one the user had individually set to something else.
- **Hurts when:** The user made a deliberate one-off exception earlier.
- **Fix:** Track `category_source = 'user_row'` vs `'user_rule'` and skip
  per-row ones.

### T78 — Text search scans the user's rows · Active · (D29)
- **We accept:** `q` uses `ILIKE '%…%'`, which no ordinary index helps.
- **Hurts when:** A user has hundreds of thousands of transactions.
- **Fix:** A `pg_trgm` GIN index on `description`.

### T79 — Dashboard aggregates are computed on every request · Active · (D30)
- **We accept:** Each dashboard load scans the user's matching rows (using
  the `(user_id, date)` index) four times.
- **Hurts when:** Users with hundreds of thousands of rows reload often.
- **Fix:** Monthly roll-up table maintained at import / correction, or cache
  per (user, filters) invalidated on change.

### T80 — "Money out" includes moving money between your own accounts · Active · (D30)
- **We accept:** Totals are by direction; a transfer to your own savings
  account is money out, and the matching credit in the other account (if
  uploaded too) is money in.
- **Hurts when:** Someone uploads several of their own accounts and reads
  the totals as spending.
- **Fix:** Detect self-transfers (same amount out/in on the same day across
  the user's accounts) or let the user mark a category as "not spending";
  the frontend can show expense categories only.

### T81 — The four dashboard queries are not one snapshot · Active · (D30)
- **We accept:** They run in parallel on separate connections; an import
  committing in between could make totals and categories differ briefly.
- **Hurts when:** Rarely — only during an import, and the next load is right.
- **Fix:** Run them in one `REPEATABLE READ` transaction (serially).

### T82 — The PDF lists at most 500 transactions · Active · (D31)
- **We accept:** Longer reports show totals for everything but list only
  the first 500 rows (it says so on the page).
- **Hurts when:** Someone wants a printable list of a whole year.
- **Fix:** Stream the PDF page by page without `bufferPages` (drop "of y"),
  or generate big reports in the background worker.

### T83 — PDF fonts have no ₹ and no Indian scripts · Active · (D31)
- **We accept:** Amounts say "Rs"; characters outside Western European
  (Devanagari etc.) print as "?".
- **Hurts when:** A description is in Hindi or another script.
- **Fix:** Bundle a Unicode font (e.g. Noto Sans) with the backend and
  register it in pdfkit.

### T84 — Excel turns long references into numbers when opening the CSV · Active · (D31)
- **We accept:** The CSV contains `0000006266119255`, but Excel shows
  `6.26612E+09` (and drops the zeros) unless the column is imported as text.
- **Hurts when:** Someone reconciles references in Excel.
- **Fix:** Write references as `="0000006266119255"` (an Excel-only trick
  that other tools show literally), or offer an `.xlsx` export.

### T85 — Requests with an unknown Origin are refused, not just hidden · Active · (D32)
- **We accept:** Any request whose `Origin` isn't in `CORS_ORIGINS` gets 403,
  including pages served from the API's own host (none today) and some
  browser extensions.
- **Hurts when:** A new frontend URL (preview deploys, a second domain) is
  added without updating `CORS_ORIGINS`.
- **Fix:** Add the origin to the env var; for preview deploys, a pattern
  allow-list (carefully anchored).

### T86 — The refresh cookie needs frontend and API on the same site · Planned (decided: D34) · (D32)
- **We accept:** `SameSite=Lax` means the browser only sends the refresh
  cookie when the frontend and API share a registrable domain.
- **Hurts when:** The frontend is deployed on another site (e.g. a
  `*.vercel.app` URL calling an EC2 domain): refresh silently fails and users
  are logged out every 15 minutes.
- **Fix:** Use one domain (`app.` + `api.`), or switch to `SameSite=None;
  Secure` plus a CSRF check on `/auth/refresh` (the Origin check in D32
  already provides one). Decided in production readiness.

## Validation & errors

### T11 — Zod silently drops unknown fields · Active · (D8)
- **We accept:** Extra fields (e.g. `isAdmin`) are stripped without telling the
  client. This blocks mass assignment, but a client typo like `emial` is also
  dropped silently and shows up as "email is required", not "unknown field".
- **Hurts when:** Debugging frontend bugs caused by misspelled field names.
- **Fix:** Use `z.strictObject(...)` to reject unknown keys with a 400 instead.

### T12 — Generic message for unexpected (500) errors · Active · (D8)
- **We accept:** Clients only see "Something went wrong" + `requestId`. The
  real error is only in server logs.
- **Hurts when:** Debugging without access to the logs.
- **Fix:** Intended. Always search logs by `requestId`.

### T13 — 100 KB JSON body limit · Active · (D8)
- **We accept:** Any JSON body over 100 KB gets a 413.
- **Hurts when:** A legitimate JSON request is bigger (unlikely for this app).
- **Fix:** Raise per route. CSV uploads will use a separate, larger limit.

## Logging & observability

### T14 — Hand-written `console.log` JSON logger · Active · (D7)
- **We accept:** No configurable log levels, no automatic redaction of
  sensitive fields, and `console.log` writes synchronously, which can slow
  responses under heavy load. Log files grow forever unless rotated.
- **Hurts when:** High traffic, or someone accidentally logs a password/token.
- **Fix:** Swap in `pino` / `pino-http` (async, fast, has redaction); configure
  pm2 log rotation (`pm2-logrotate`) on EC2.

### T15 — Clients can choose their own request ID · Active · (D7)
- **We accept:** A safe-looking incoming `X-Request-Id` is reused as-is, so a
  client can send the same ID many times or copy someone else's.
- **Hurts when:** Searching logs by ID returns unrelated requests that reused it.
- **Fix:** Once nginx generates the ID, only accept it from the proxy (ignore
  the header from the public internet), or always log our own ID alongside the
  incoming one.

### T17 — Logs only, no metrics or tracing yet · Active (postponed, see TASKS.md)
- **We accept:** The only observability is one JSON log line per request.
  No dashboards, no alerts, no per-step timing inside a request.
- **Hurts when:** We need trends over time ("is it getting slower?"), alerts
  when error rates spike, or to find which step of a slow CSV upload is slow.
- **Fix:** Add `prom-client` metrics + OpenTelemetry tracing before deployment,
  once real features exist to measure.

## Tooling

### T16 — Node's built-in `--env-file` and `node:test` · Active · (D4, D7)
- **We accept:** Requires Node ≥ 20.6 everywhere (dev machine, EC2). The
  built-in test runner has fewer features than Jest (no snapshots, simpler mocks).
- **Hurts when:** EC2 has an older Node, or we need heavy mocking later.
- **Fix:** Install Node 24 on EC2 (e.g. via nvm); add a library only if a test
  genuinely needs it.

## Frontend & deployment

### T87 — Every page load starts with a refresh · Active · (D33)
- **We accept:** The access token lives only in memory, so each reload or
  new tab asks `/auth/refresh` first (one extra request, ~100–300 ms).
- **Hurts when:** Rarely; only the first paint waits a little.
- **Fix:** None needed; it's the price of not storing tokens where scripts
  can read them.

### T88 — Cross-tab refresh protection needs the Web Locks API · Active · (D33)
- **We accept:** Browsers without `navigator.locks` (very old ones) only get
  per-tab protection; two such tabs refreshing at the same instant can end
  the session.
- **Hurts when:** Someone uses an outdated browser with several tabs.
- **Fix:** A small grace period on the backend for a just-rotated token.

### T89 — The CSP allows inline styles · Active · (D33)
- **We accept:** `style-src 'unsafe-inline'`, because React sets `style=""`
  for bar widths and the chart library does too.
- **Hurts when:** An injection could restyle the page (it still can't run
  scripts or send data elsewhere).
- **Fix:** Draw bars with SVG attributes / CSS classes only, then drop it.

### T90 — Status by polling · Active · (D33)
- **We accept:** Upload pages poll every 1.5–2 s while processing.
- **Hurts when:** Many users watch imports at once (many small requests).
- **Fix:** Server-sent events from the API for stage changes.

### T91 — Preview deployments can't log in to production · Active · (D34)
- **We accept:** `*.vercel.app` previews are not in `CORS_ORIGINS` and not on
  the cookie's site.
- **Hurts when:** Reviewing a change end to end before merging.
- **Fix:** A staging backend that allows a preview domain like
  `preview.<domain>` (Vercel can assign one per branch).

### T92 — The e2e smoke test leaves test users behind · Active · (D33)
- **We accept:** `npm run e2e` signs up new `@e2e.example.test` users; there
  is no API to delete accounts yet, so they're removed with one SQL line.
- **Hurts when:** Running it against production repeatedly.
- **Fix:** An account-deletion endpoint (also needed for the retention
  decision, T34/T39).

### T93 — Rate limits are per IP · Active · (D36)
- **We accept:** Everyone behind one IP (an office, a college, a mobile
  carrier's shared address) shares the limits, e.g. 5 sign-ups per hour.
- **Hurts when:** Many real users come from one network.
- **Fix:** Limit login per IP + email, and other routes per logged-in user
  instead of per IP.

### T94 — A backend deploy means ~2 seconds without the API · Active · (D39)
- **We accept:** pm2 runs one API process (fork mode); a reload stops it and
  starts the new one. Requests in those ~2 s fail (the frontend shows
  "could not reach the server"; retrying works).
- **Hurts when:** Someone is mid-upload or mid-request exactly at deploy time.
- **Fix:** Two API processes in pm2 cluster mode (reload one at a time),
  when RAM allows (each costs ~110 MB on the 1 GB machine).

### T95 — SSH open to the whole internet · Active · (D39)
- **We accept:** Port 22 accepts connections from anywhere so GitHub's
  runners can deploy. Only keys work (password login is off), but bots will
  keep trying.
- **Hurts when:** A future OpenSSH vulnerability, or a leaked key.
- **Fix:** Let the workflow open port 22 for its own IP via the AWS API for
  the length of the deploy (needs AWS credentials on GitHub), or deploy
  through AWS Systems Manager instead of SSH; fail2ban to slow bots.

### T96 — CI tests a plain Postgres, not Supabase · Active · (D39)
- **We accept:** GitHub's tests use a stock Postgres 17 without TLS; the two
  certificate tests are skipped there.
- **Hurts when:** Something behaves differently on Supabase (pooler, TLS,
  extensions) and only shows up after deploying.
- **Fix:** Keep running `npm test` locally against Supabase before merging
  to `main` (it covers the skipped tests); a separate Supabase test project
  for CI if it ever matters.
