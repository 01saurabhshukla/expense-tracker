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
- **Trade-off:** Only body validation so far. In Express 5 `req.query` is
  read-only, so query validation will store its result elsewhere when needed.

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

## Open questions

- **Auth transport:** httpOnly cookie (needs `SameSite=None; Secure` across
  domains) vs `Authorization: Bearer` token. Decide when building auth.
