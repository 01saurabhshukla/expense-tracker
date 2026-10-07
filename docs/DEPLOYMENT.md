# Deployment

How the two halves are hosted, why, and the exact steps. Decisions: D2
(separate hosting), D33 (frontend), D34 (this strategy). Backend hardening
that is still to do is listed in DECISIONS.md → "Revisit before deploying".

## Current setup (2026-10-07): everything on one EC2, two DuckDNS names

Until a domain is bought, the website and the API both run on the EC2
instance (3.110.119.202, Ubuntu 26.04, 1 GB RAM + 1 GB swap):

| Name | Serves |
|---|---|
| `https://saurabh-shukla.duckdns.org` | the website (static files from `/var/www/expense-tracker/current`) |
| `https://api.saurabh-shukla.duckdns.org` | the API (nginx → Node on 127.0.0.1:4000) |

Both are under `saurabh-shukla.duckdns.org`, so browsers treat them as one
site and the `SameSite=Lax` refresh cookie works with no code changes.
Moving the website to Vercel later only needs a bought domain (DuckDNS can't
point `app.` and `api.` to different places).

Done so far:

1. **Base:** security updates + reboot; Redis capped at 64 MB with
   `noeviction` (config backup kept); certbot; pm2 logs rotated by
   `/etc/logrotate.d/expense-tracker-pm2` (no extra RAM).
2. **Backend:** code in `~/expense-tracker` (a `git reset --hard origin/main`
   copy), `backend/.env` filled in by hand (secrets never left the server),
   uploads in `/var/lib/expense-tracker/storage` (outside the code),
   pm2 runs `expense-api` + `expense-worker` from
   `docs/deploy/ecosystem.config.cjs`, started on boot (`pm2-ubuntu` service,
   verified with a reboot).
3. **nginx + HTTPS:** `docs/deploy/nginx/*` installed (see below); one Let's
   Encrypt certificate for both names, renewed automatically.

Next: 4. build and upload the website; 5. CI/CD (GitHub Actions).

## nginx in detail

Files (both in this repository, copied to the server):

| Repository | Server |
|---|---|
| `docs/deploy/nginx/expense-tracker.conf` | `/etc/nginx/sites-available/expense-tracker` (+ symlink in `sites-enabled/`) |
| `docs/deploy/nginx/security-headers.conf` | `/etc/nginx/snippets/expense-security-headers.conf` |

Ubuntu's `default` site was removed from `sites-enabled`. Ubuntu's own
`/etc/nginx/nginx.conf` (untouched) provides the basics: worker processes,
TLS 1.2/1.3 only, logs in `/var/log/nginx/`, gzip on.

How nginx picks a `server` block: by the port the request arrived on, then
by the name in the request (`Host` header, or the TLS SNI name). If no
`server_name` matches, the `default_server` for that port answers.

**Block 1, the catch-all (`default_server`, ports 80 and 443).** Requests
for the bare IP or any unknown name (internet scanners do this constantly):
`return 444` closes the connection without a reply, and
`ssl_reject_handshake on` refuses TLS without showing a certificate, so a
scanner learns nothing about which names live here.

**Block 2, port 80 for our names.** Two jobs:
`/.well-known/acme-challenge/` serves files from `/var/www/letsencrypt`
(Let's Encrypt fetches a one-time file from there to confirm we control the
name, for the first certificate and every renewal); everything else gets a
`301` redirect to the same URL on `https://`.

**Shared TLS settings (outside any server, so both HTTPS blocks use them):**
the certificate and key from `/etc/letsencrypt/live/saurabh-shukla.duckdns.org/`
(one certificate lists both names), a 5 MB session cache shared between
nginx's worker processes so returning visitors skip the full handshake,
sessions kept 1 day, session tickets off (they weaken forward secrecy unless
their keys are rotated).

**Block 3, the website (`saurabh-shukla.duckdns.org`, 443).**
- `root /var/www/expense-tracker/current`: a *symlink* to a release folder
  (`releases/<id>`). A deploy uploads a complete new folder, then switches
  the link in one step, so a visitor never gets half old, half new files.
  Old releases stay for an instant rollback.
- `http2 on`: several files over one connection.
- `gzip_types`: also compress CSS, JS, JSON and SVG (Ubuntu's default only
  compresses HTML): the 300 KB main script travels as ~90 KB.
- `location /assets/`: file names contain a content hash
  (`index-C9YIcoec.js`), so a name never changes meaning: browsers may keep
  them a year (`immutable`). `try_files $uri =404`: a missing asset is a
  real 404, not the app's HTML (which would break as "JavaScript").
- `location = /index.html`: `no-cache`, so browsers check for a new one on
  every visit; it names the current asset files, so this is how a deploy
  reaches users immediately.
- `location /` with `try_files $uri /index.html`: real files are served as
  they are; anything else (`/transactions`, `/uploads/123`, React Router
  pages that exist only in the browser) gets `index.html`, and the app shows
  the right page. Without this, reloading `/transactions` would be a 404.

**Block 4, the API (`api.saurabh-shukla.duckdns.org`, 443).**
- `client_max_body_size 11m`: the app allows 10 MB statements; nginx refuses
  anything larger with `413` before it reaches Node (tested with 12 MB).
- `proxy_pass http://127.0.0.1:4000`: Node only listens on the machine
  itself; ports 4000 and 6379 are closed in the security group (tested from
  outside: timed out).
- Headers passed to Node: `Host`; `X-Forwarded-For` with the visitor's IP
  appended by nginx (Express takes that last entry because
  `TRUST_PROXY=loopback`, so a client can't fake it, D35); `X-Forwarded-Proto`;
  `X-Request-Id: $request_id`, a random id generated by nginx for every
  request and used by the app in its logs and error replies, which also
  means a client can no longer pick its own (T15).
- `proxy_request_buffering off`: uploads stream through to Node as they
  arrive (Node checks login, size and type while streaming) instead of
  nginx first saving the whole file to disk.
- `proxy_send_timeout` / `proxy_read_timeout 120s`: slow mobile uploads and
  big exports are not cut off at nginx's default 60 s.

**The security headers snippet, and the nginx trap it avoids.** nginx
inherits `add_header` lines from the outer block into a `location` *only if
that location has no `add_header` of its own*. The `/assets/` and
`/index.html` locations add `Cache-Control`, so without care they would
silently lose every security header. That's why the headers live in one
snippet that is `include`d in each server and again in each of those
locations. `always` adds them to error responses too. What they do: HSTS
(browsers use HTTPS for a year), `frame-ancestors 'none'` + `X-Frame-Options`
(no clickjacking), `nosniff`, a strict `Referrer-Policy`, and a
`Permissions-Policy` turning off camera, microphone, location and payments.

**Certificates.** Obtained with `certbot certonly --webroot` (certbot only
writes files under `/etc/letsencrypt`; it never edits our nginx config, so
the server matches the repository). `certbot.timer` checks twice a day and
renews about 30 days before expiry (current certificate: until
2027-01-05), then runs the saved deploy hook `systemctl reload nginx`.
`certbot renew --dry-run` passed. To get expiry warnings by email:
`sudo certbot update_account --email you@example.com`.

**Checked from outside after installing:** API `/health` 200; website 200;
`http://` → `301` to `https://`; `/uploads/123` → 200 (SPA fallback); bare
IP over HTTP and HTTPS → connection closed; CORS preflight from the website
→ 204 with its origin; another origin → 403; 12 MB upload → 413; all
security headers present; certificate chain verifies.

**Useful commands on the server:**
`sudo nginx -t` (test config before reloading) · `sudo systemctl reload nginx`
(apply without dropping connections) · `sudo tail -f /var/log/nginx/access.log`
· `sudo certbot certificates` (expiry dates) · `pm2 logs` · `pm2 list`.

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
   DATABASE_URL=<Transaction pooler URL as expense_app — `npm run db:app-role` writes it>
   MIGRATION_DATABASE_URL=<the postgres pooler URL, for migrations only>
   DATABASE_CA_CERT=certs/supabase-ca.crt
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
