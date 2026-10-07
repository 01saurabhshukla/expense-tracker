#!/usr/bin/env bash
# Deploys the backend ON the EC2 server (DEPLOYMENT.md). Run it AFTER the
# code is updated, never as part of the same command that updates it (bash
# reads a script while running it, so replacing it mid-run is unsafe):
#
#   cd ~/expense-tracker && git fetch -q origin main && git reset -q --hard <commit>
#   bash docs/deploy/deploy-backend.sh
#
# CI (GitHub Actions) runs exactly these two lines over SSH.
#
# Steps: install production packages → run migrations (as the admin role,
# MIGRATION_DATABASE_URL) → start or gracefully reload the API and worker →
# wait for /health. Any failing step stops the deploy with an error.
set -euo pipefail

cd "$(dirname "$0")/../.."
echo "== deploying $(git log --oneline -1)"

cd backend
echo "== 1. install (production packages only)"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

echo "== 2. migrations"
npm run -s migrate

echo "== 3. start or reload API + worker"
# startOrReload: starts them on the first deploy, reloads them afterwards.
# The worker gets 30 s (kill_timeout) to finish a running import.
pm2 startOrReload ../docs/deploy/ecosystem.config.cjs --update-env
pm2 save >/dev/null

echo "== 4. health check"
for attempt in $(seq 1 20); do
  if curl -fsS -m 3 http://127.0.0.1:4000/health >/dev/null; then
    echo "API healthy after ${attempt} check(s)"
    pm2 list | grep -E "expense-(api|worker)"
    exit 0
  fi
  sleep 2
done
echo "API did not become healthy; last log lines:" >&2
pm2 logs expense-api --lines 30 --nostream >&2 || true
exit 1
