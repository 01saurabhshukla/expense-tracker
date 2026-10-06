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

### T6 — SSL without certificate verification · Dev-only · (applies to `pool.js` too)
- **We accept:** `ssl: { rejectUnauthorized: false }` — traffic is encrypted but
  we don't verify we're talking to the real Supabase server.
- **Hurts when:** Someone on the network path impersonates the DB server
  (man-in-the-middle) — they could read credentials and data.
- **Fix:** Download Supabase's CA certificate and pass it as `ssl.ca`.

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

### T20 — Backend uses the `postgres` superuser role · Active
- **We accept:** The app connects as `postgres`, which bypasses RLS and can do
  anything, including dropping tables.
- **Hurts when:** A SQL injection bug or a leaked `DATABASE_URL` → full
  control of the database.
- **Fix:** Before deploying, create a limited role that can only
  SELECT/INSERT/UPDATE/DELETE our tables; use `postgres` only for migrations.

### T21 — Tests run against the real Supabase project · Active
- **We accept:** Database tests use the same project as development (user's
  choice over a separate test project). Test users use `@example.test`
  emails and are deleted after each test file. Migrations themselves are still
  only verified by hand.
- **Hurts when:** A test crashes before cleanup (leftover test rows), a buggy
  cleanup query deletes real data, tests run in parallel with real usage, or
  tests become slow because every run goes over the network (~3s per signup).
  `npm test` also needs `.env` and internet access.
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

### T9 — Fixed-window, in-memory rate limiter · Planned (postponed, see TASKS.md)
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

### T10 — Client IP depends on correct `trust proxy` · Planned (postponed, see TASKS.md)
- **We accept:** Behind nginx, the real client IP comes from the
  `X-Forwarded-For` header, which we trust only from loopback (nginx on the
  same machine).
- **Hurts when:** The proxy setup changes (e.g. an AWS load balancer in front)
  and the setting isn't updated → everyone shares one limit, or clients can
  spoof their IP and dodge limits.
- **Fix:** Update `trust proxy` whenever the network path in front of the app changes.

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
