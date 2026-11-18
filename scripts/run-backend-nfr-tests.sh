#!/usr/bin/env bash
#
# Run backend NFR tests in backend/tests/nfr/
#
# Usage:
#   ./scripts/run-backend-nfr-tests.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
NFR_DIR="$BACKEND_DIR/tests/nfr"

info() { printf '\033[34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mWARN:\033[0m %s\n' "$*"; }
die()  { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

has_test_files() {
  find "$1" -name "$2" -print -quit 2>/dev/null | grep -q .
}

# ---------------------------------------------------------------------------
# Discover backend NFR tests
# ---------------------------------------------------------------------------
if [[ -d "$NFR_DIR" ]] && has_test_files "$NFR_DIR" '*.test.ts'; then
  :
elif [[ -d "$NFR_DIR" ]]; then
  warn "Skipping backend NFR tests: no *.test.ts files in backend/tests/nfr/ yet."
  exit 0
else
  warn "Skipping backend NFR tests: backend/tests/nfr/ not found yet."
  exit 0
fi

command -v node >/dev/null 2>&1 || die "Node.js not found."
command -v npm  >/dev/null 2>&1 || die "npm not found."

if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
  info "Installing backend dependencies ..."
  ( cd "$BACKEND_DIR" && npm install )
fi

# ---------------------------------------------------------------------------
# MongoDB for the tests
# ---------------------------------------------------------------------------
# Uses TEST_MONGODB_URI if set; otherwise starts docker-compose.test.yml and stops it on exit.
if [[ -n "${TEST_MONGODB_URI:-}" ]]; then
  info "Using MongoDB at $TEST_MONGODB_URI"
else
  command -v docker >/dev/null 2>&1 || die "Docker not found. Install it, or start a MongoDB and set TEST_MONGODB_URI."
  info "Starting a throwaway MongoDB (docker-compose.test.yml)..."
  docker compose -f "$ROOT/docker-compose.test.yml" up -d --wait || die "Could not start the test MongoDB."
  trap 'docker compose -f "$ROOT/docker-compose.test.yml" down >/dev/null 2>&1' EXIT
  export TEST_MONGODB_URI="mongodb://127.0.0.1:27018/?directConnection=true"
fi

info "Running backend NFR tests (tests/nfr/) ..."
( cd "$BACKEND_DIR" && npm test -- tests/nfr/ )

echo
info "Backend NFR tests finished."
