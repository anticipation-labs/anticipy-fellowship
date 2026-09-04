#!/usr/bin/env bash
# Manual fallback only. Normal production deployments come from Cloudflare's
# Git integration when main changes.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

npm run check
npm run deploy:cloudflare
