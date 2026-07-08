#!/usr/bin/env bash
# Run a SQL file against the linked Supabase project (Summit Church School Members).
#
# One-time setup:
#   1. Create a token: https://supabase.com/dashboard/account/tokens
#   2. Log in: supabase login
#      (paste the token when prompted)
#
# Usage:
#   ./supabase/run-sql.sh supabase/conduct-signed-at.sql

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SQL_FILE="${1:-}"

if [[ -z "$SQL_FILE" ]]; then
  echo "Usage: ./supabase/run-sql.sh <path-to.sql>" >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/$SQL_FILE" && ! -f "$SQL_FILE" ]]; then
  echo "SQL file not found: $SQL_FILE" >&2
  exit 1
fi

if [[ -f "$ROOT_DIR/$SQL_FILE" ]]; then
  SQL_FILE="$ROOT_DIR/$SQL_FILE"
fi

if ! supabase projects list --workdir "$ROOT_DIR" >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Supabase CLI is not authenticated.

Run this once:
  supabase login

Create a personal access token here if needed:
  https://supabase.com/dashboard/account/tokens

Or set SUPABASE_ACCESS_TOKEN in your shell before running this script.
EOF
  exit 1
fi

echo "Running $SQL_FILE on linked project..."
supabase db query --linked --workdir "$ROOT_DIR" -f "$SQL_FILE"
echo "Done."