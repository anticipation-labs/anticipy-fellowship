#!/usr/bin/env bash
# Compose this repo over the full backend tree and ship it.
#
# The fellowship shares one PocketBase with HQ (see README), so a deploy needs
# both trees. This copies the fellowship half over a clean copy of the backend
# and pushes that — it never deploys from the backend tree in place, because
# two stale-directory deploys have already shipped the wrong bytes.
set -euo pipefail

BACKEND="${ANTICIPY_BACKEND_TREE:-$HOME/Documents/Codex/Anticipy-Recovery-2026-08-12/backend}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ -d "$BACKEND/pb_hooks" ] || { echo "No backend tree at $BACKEND. Set ANTICIPY_BACKEND_TREE."; exit 1; }

STAGE="$(mktemp -d)/deploy"
mkdir -p "$STAGE"
cp -R "$BACKEND"/. "$STAGE"/
cp "$HERE"/pb_hooks/*.pb.js        "$STAGE/pb_hooks/"
cp "$HERE"/pb_public/*.html        "$STAGE/pb_public/"
mkdir -p "$STAGE/pb_public/assets"
cp "$HERE/pb_public/assets/favicon.png" "$STAGE/pb_public/assets/"
cp "$HERE/pb_public/assets/prototype-bench.jpg" "$STAGE/pb_public/assets/"
cp "$HERE"/pb_migrations/*.js      "$STAGE/pb_migrations/"

echo "staged at $STAGE"
node --check "$STAGE/pb_hooks/fellowship.pb.js"
echo "syntax ok. now: cd $STAGE && railway up"
echo
echo "AFTER DEPLOY, BYTE-VERIFY. railway up has reported success while failing:"
echo "  curl -s https://anticipyfellowship.com/fellowships.html | cmp - $HERE/pb_public/fellowships.html && echo MATCH"
echo "  curl -s https://anticipyfellowship.com/assets/favicon.png | cmp - $HERE/pb_public/assets/favicon.png && echo MATCH"
echo "  curl -s https://anticipyfellowship.com/assets/prototype-bench.jpg | cmp - $HERE/pb_public/assets/prototype-bench.jpg && echo MATCH"
