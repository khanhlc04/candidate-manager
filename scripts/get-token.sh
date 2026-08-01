#!/usr/bin/env bash
# Lấy access_token (JWT) của một user để test API bằng curl.
# Dùng: ./scripts/get-token.sh hr.a@test.com Test123456!
set -euo pipefail

: "${SUPABASE_URL:?export SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?export SUPABASE_ANON_KEY}"

curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])"
