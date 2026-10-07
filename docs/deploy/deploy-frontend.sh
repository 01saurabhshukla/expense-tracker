#!/usr/bin/env bash
# Builds the website and publishes it on the EC2 server (DEPLOYMENT.md).
# Used by hand and by CI (GitHub Actions) alike.
#
#   VITE_API_URL=https://api.saurabh-shukla.duckdns.org \
#   DEPLOY_HOST=ubuntu@3.110.119.202 \
#   DEPLOY_SSH_KEY_FILE=~/Downloads/node-server-key.pem \
#   docs/deploy/deploy-frontend.sh
#
# Steps:
#   1. build frontend/dist (the build refuses to run without VITE_API_URL);
#   2. upload it to a NEW folder /var/www/expense-tracker/releases/<id>;
#   3. switch the `current` link to it in one atomic step (nginx serves
#      `current`, so visitors get either the old site or the new one,
#      never a mix);
#   4. keep the 5 newest releases for instant rollback, delete older ones.
#
# Rollback: ssh in and point `current` at an older folder in releases/.
set -euo pipefail

: "${VITE_API_URL:?set VITE_API_URL, e.g. https://api.saurabh-shukla.duckdns.org}"
: "${DEPLOY_HOST:?set DEPLOY_HOST, e.g. ubuntu@3.110.119.202}"
SSH=(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes)
[ -n "${DEPLOY_SSH_KEY_FILE:-}" ] && SSH+=(-i "$DEPLOY_SSH_KEY_FILE")

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RELEASES=/var/www/expense-tracker/releases
RELEASE="$(date -u +%Y%m%d-%H%M%S)-$(git -C "$ROOT" rev-parse --short HEAD)"

echo "== 1. build (API: $VITE_API_URL)"
cd "$ROOT/frontend"
VITE_API_URL="$VITE_API_URL" npx vite build --logLevel warn
# The page's Content-Security-Policy must allow this API: its connect-src
# rule ends with "<API URL>;" (plain text check; quotes in the attribute are
# HTML-escaped as &#39;, so don't match on them).
grep -qF " $VITE_API_URL;" dist/index.html \
  || { echo "built page does not allow $VITE_API_URL (CSP)"; exit 1; }

echo "== 2. upload to $RELEASES/$RELEASE"
tar -C dist -czf - . | "${SSH[@]}" "$DEPLOY_HOST" "mkdir -p $RELEASES/$RELEASE && tar -C $RELEASES/$RELEASE -xzf -"

echo "== 3. switch + 4. clean up"
"${SSH[@]}" "$DEPLOY_HOST" bash -s <<REMOTE
set -euo pipefail
cd $RELEASES/..
test -f $RELEASES/$RELEASE/index.html
# Make the new link under a temporary name, then rename it over "current":
# a rename is atomic, so there is no moment without a site.
ln -sfn $RELEASES/$RELEASE current.new
mv -Tf current.new current
echo "current -> \$(readlink current)"
ls -1dt $RELEASES/*/ | grep -v placeholder | tail -n +6 | xargs -r rm -rf
echo "releases kept: \$(ls $RELEASES | grep -vc placeholder)"
REMOTE
echo "== done: $RELEASE"
