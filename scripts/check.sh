#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_STAGE="$(mktemp -d)/anticipy-fellowship-check"
trap 'rm -rf "${TEST_STAGE:?}"' EXIT

for file in "$PROJECT_DIR"/pb_hooks/*.pb.js "$PROJECT_DIR"/pb_migrations/*.js; do
  node --check "$file"
done
node --check "$PROJECT_DIR/cloudflare/index.js"

for file in "$PROJECT_DIR"/pb_public/*.html; do
  node - "$file" <<'NODE'
const fs = require("fs");
const html = fs.readFileSync(process.argv[2], "utf8");
const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let match;
let parsed = 0;
while ((match = scripts.exec(html))) {
  const attrs = match[1] || "";
  if (/\bsrc\s*=/.test(attrs)) continue;
  if (/\btype\s*=/.test(attrs) && !/javascript|module/i.test(attrs)) continue;
  new Function(match[2]);
  parsed++;
}
if (!parsed) throw new Error(`no inline JavaScript found in ${process.argv[2]}`);
NODE
done

# The historical tests expect the repository inside a larger `backend/`
# checkout. Build that shape with temporary symlinks so the checks stay local
# and never contact the live service.
mkdir -p "$TEST_STAGE/backend" "$TEST_STAGE/overnight"
cp -R "$PROJECT_DIR/tests" "$TEST_STAGE/tests"
ln -s "$PROJECT_DIR/pb_hooks" "$TEST_STAGE/backend/pb_hooks"
ln -s "$PROJECT_DIR/pb_migrations" "$TEST_STAGE/backend/pb_migrations"
ln -s "$PROJECT_DIR/pb_public" "$TEST_STAGE/backend/pb_public"
ln -s "$PROJECT_DIR/docs" "$TEST_STAGE/docs"
ln -s "$PROJECT_DIR/gate/fellowship_gate.py" "$TEST_STAGE/overnight/fellowship_gate.py"

for test_file in "$TEST_STAGE"/tests/*.mjs; do
  node "$test_file"
done
