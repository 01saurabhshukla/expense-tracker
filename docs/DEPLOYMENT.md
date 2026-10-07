# Deployment

How the two halves are hosted, why, and the exact steps. Decisions: D2
(separate hosting), D33 (frontend), D34 (this strategy). Backend hardening
that is still to do is listed in DECISIONS.md → "Revisit before deploying".

## The shape

```
             https://app.<your-domain>                 https://api.<your-domain>
 Browser ──► Vercel (static React build)     Browser ──► EC2: nginx (HTTPS) ──► Node API (pm2)
             index.html + /assets/*                                   │            │
                                                                      │       BullMQ queue
                                                                      │            │
                                                     Redis (127.0.0.1) ◄──── Node worker (pm2)
                                                                      │
                                                     Supabase Postgres (TLS)
```

- **Vercel serves only static files** (the output of `vite build`). No
  server code runs there.
- **The browser calls the API directly** at `https://api.<your-domain>`
  (`VITE_API_URL`). Bearer token for every call; the refresh cookie only on
  `/auth/*`.
- **EC2 runs everything with state:** the API, the background worker,
  Redis, the uploaded files. That's why the backend can't be on Vercel:
  a long-running worker, a job queue and files on disk don't fit serverless
  functions (and their request bodies are capped well below our 10 MB uploads).

## Why one domain with two subdomains

Buy or use any domain, e.g. `example.com`:

| Host | Points to |
|---|---|
| `app.example.com` | Vercel |
| `api.example.com` | the EC2 instance (Elastic IP) |

This one choice makes four things work:

1. **The refresh cookie.** It's `SameSite=Lax` (CSRF protection), so the
   browser only sends it when the page and the API are on the *same site*.
   `app.example.com` and `api.example.com` are the same site
   (`example.com`). A `*.vercel.app` page calling a different domain is not,
   and users would be logged out every 15 minutes (T86).
2. **HTTPS on the API.** The page is HTTPS, and browsers block calls from
   an HTTPS page to an HTTP API (mixed content). Let's Encrypt needs a domain
   name for the certificate.
3. **CORS** stays a one-line allow-list: `CORS_ORIGINS=https://app.example.com`.
4. **The Content Security Policy** names exactly one API origin.

**Without your own domain** (not recommended): a Vercel rewrite could proxy
`/api/*` to the backend so everything is same-origin. That needs backend
changes (the cookie path `/auth` becomes `/api/auth`), the backend still
needs HTTPS for the Vercel→EC2 hop, and uploads would pass through
Vercel's proxy and its request limits. Decide before deploying; the
frontend needs only a different `VITE_API_URL` (`/api`).

## Frontend on Vercel

One-time setup:

1. Push the repository to GitHub (the `main` branch).
2. Vercel → **Add New → Project** → import the repository.
3. **Root Directory: `frontend`**. Framework: Vite (detected; `vercel.json`
   also says so). Build `npm run build`, output `dist`.
4. **Environment variables → `VITE_API_URL` = `https://api.example.com`**
   for *Production*. (Vite bakes it into the build, so changing it needs a
   redeploy.)
5. **Settings → Domains → add `app.example.com`** and create the DNS record
   Vercel shows. Vercel issues the HTTPS certificate.
6. Deploy. Every push to `main` deploys again; other branches get preview URLs.

What `frontend/vercel.json` does:

- **SPA fallback:** any path that isn't a file (`/transactions`,
  `/uploads/123`) serves `index.html`, so reloads and shared links work.
  Real files (`/assets/…`) are served first.
- **Security headers:** `frame-ancestors 'none'` + `X-Frame-Options: DENY`
  (no clickjacking), `nosniff`, a strict referrer policy, no camera/mic/
  location access.
- **Caching:** `/assets/*` files have content hashes in their names →
  cached for a year; `index.html` is never cached, so a new deploy is
  picked up immediately.
- The page's **Content Security Policy** is added to `index.html` at build
  time (`vite.config.js`), with `connect-src` limited to the site and
  `VITE_API_URL`.

**Preview deployments** (`*.vercel.app`) can't log in against the
production API: their origin isn't in `CORS_ORIGINS` and they're on a
different site for the cookie. Use them to look at UI changes, or point
the Preview `VITE_API_URL` at a staging API that allows that origin (T91).

## Backend on EC2

Part of the pending **production readiness** step; the plan:

1. **Instance:** Ubuntu LTS, t3.small (2 GB) or bigger. Elastic IP. Security
   group: 80 and 443 from anywhere, 22 from your IP only. 6379 never open.
   Encrypted EBS volume (uploaded statements live on it, T34).
2. **Software:** Node 24 (nvm), Redis 7 (`bind 127.0.0.1`, `protected-mode
   yes`, `maxmemory-policy noeviction`), nginx, certbot, pm2.
3. **Code:** `git clone`, `cd backend && npm ci --omit=dev`.
4. **`backend/.env`:**
   ```
   NODE_ENV=production
   DATABASE_URL=<Supabase pooler URL, limited role — not postgres>
   JWT_ACCESS_SECRET=<48 random bytes, base64url>
   CORS_ORIGINS=https://app.example.com
   TRUST_PROXY=loopback
   UPLOAD_DIR=/var/lib/expense-tracker/storage
   ```
   `NODE_ENV=production` turns on the `Secure` cookie flag; the server
   refuses to start without `CORS_ORIGINS` (D32).
5. **Database:** `npm run migrate` once per release, before restarting.
6. **Processes:** pm2 runs two: `npm start` (API) and `npm run worker`;
   `pm2 save` + `pm2 startup` so they come back after a reboot. Example:
   `docs/deploy/ecosystem.config.cjs`.
7. **nginx + HTTPS:** `docs/deploy/nginx.conf.example` (body limit 11 MB,
   long enough timeouts for uploads), then
   `sudo certbot --nginx -d api.example.com`.
8. **DNS:** `api.example.com` A record → the Elastic IP.

## First deploy, in order

1. Backend up on EC2 (steps above); `curl https://api.example.com/health`
   → `{"status":"ok"}`.
2. CORS check from your machine:
   ```
   curl -i -X OPTIONS https://api.example.com/transactions \
     -H "Origin: https://app.example.com" -H "Access-Control-Request-Method: GET"
   ```
   → `204` with `Access-Control-Allow-Origin: https://app.example.com`.
3. Frontend on Vercel with `VITE_API_URL`; open `https://app.example.com`.
4. Sign up, log in, reload the page (still logged in = cookie works),
   upload a sample statement, watch it finish, export a PDF.
5. Optional: `E2E_BASE_URL=https://app.example.com npm run e2e` from
   `frontend/` (creates test users; delete them afterwards).

## Releasing and rolling back

- **Frontend:** push to `main`. To roll back, Vercel → Deployments →
  previous one → *Promote to Production* (instant, no rebuild).
- **Backend:** `git pull`, `npm ci --omit=dev`, `npm run migrate`,
  `pm2 reload all`. Migrations only add things, so the previous backend
  version still runs on the new schema; roll back with `git checkout
  <previous tag>` + `pm2 reload all`.
- Deploy the **backend first** when a release changes both, so the new
  frontend never calls an endpoint that doesn't exist yet.
