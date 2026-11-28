#!/usr/bin/env bash
# Sets ENABLE_E2E_ROUTES in backend/.env to $E2E (true or false), keeping every other line.
# Leaves the file unchanged when $E2E is empty. Used by .github/workflows/deploy-backend.yml.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"

case "${E2E:-}" in
  '') exit 0 ;;
  true|false) ;;
  *) echo "ERROR: E2E must be true or false." >&2; exit 1 ;;
esac
[[ -f "$ENV_FILE" ]] || { echo "ERROR: Missing $ENV_FILE" >&2; exit 1; }

tmp="$(mktemp)"
grep -v '^ENABLE_E2E_ROUTES=' "$ENV_FILE" > "$tmp" || true
echo "ENABLE_E2E_ROUTES=$E2E" >> "$tmp"
cat "$tmp" > "$ENV_FILE"
rm -f "$tmp"
echo "ENABLE_E2E_ROUTES=$E2E"
