#!/usr/bin/env bash
# Markivo post-deploy smoke test.
#
# Usage:
#   ./scripts/smoke.sh https://app.example.com            # same-origin deploy
#   ./scripts/smoke.sh https://app.example.com https://api.example.com   # split deploy
#
# Checks: API health, register + login round-trip (throwaway account),
# authenticated /api/usage, and that the frontend serves the Markivo SPA.
# Exits non-zero on the first hard failure summary.

set -u

BASE_URL="${1:-}"
if [ -z "$BASE_URL" ]; then
  echo "Usage: $0 BASE_URL [API_URL]" >&2
  exit 2
fi
API_URL="${2:-$BASE_URL}"
BASE_URL="${BASE_URL%/}"
API_URL="${API_URL%/}"

PASS=0
FAIL=0
TMP_BODY="$(mktemp)"
trap 'rm -f "$TMP_BODY"' EXIT

ok()   { PASS=$((PASS + 1)); echo "  PASS  $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; }

# request METHOD URL [JSON_BODY] [BEARER] -> sets STATUS and BODY
request() {
  local method="$1" url="$2" data="${3:-}" bearer="${4:-}"
  local args=(-sS -o "$TMP_BODY" -w '%{http_code}' -X "$method" --max-time 30)
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' -d "$data")
  [ -n "$bearer" ] && args+=(-H "Authorization: Bearer $bearer")
  STATUS="$(curl "${args[@]}" "$url" 2>/dev/null)" || STATUS="000"
  BODY="$(cat "$TMP_BODY" 2>/dev/null || true)"
}

json_field() { # json_field KEY  — naive extractor for flat string fields
  printf '%s' "$BODY" | grep -o "\"$1\":\"[^\"]*\"" | head -n1 | cut -d'"' -f4
}

echo "Markivo smoke test"
echo "  frontend: $BASE_URL"
echo "  api:      $API_URL"
echo

# 1. Health -----------------------------------------------------------------
request GET "$API_URL/api/health"
if [ "$STATUS" = "200" ]; then
  ok "/api/health -> 200"
else
  bad "/api/health -> $STATUS (expected 200). Body: $BODY"
fi

# 2. Register + login round-trip --------------------------------------------
EMAIL="smoke-$(date +%s)-$RANDOM@example.com"
PASSWORD="Smoke-test-pass-1"
request POST "$API_URL/api/auth/register" \
  "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"fullName\":\"Smoke Test\"}"
TOKEN="$(json_field token)"
if [ "$STATUS" = "200" ] && [ -n "$TOKEN" ]; then
  ok "register $EMAIL -> 200 + token"
else
  bad "register -> $STATUS or missing token. Body: $BODY"
fi

request POST "$API_URL/api/auth/login" \
  "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
LOGIN_TOKEN="$(json_field token)"
if [ "$STATUS" = "200" ] && [ -n "$LOGIN_TOKEN" ]; then
  ok "login -> 200 + token"
  TOKEN="$LOGIN_TOKEN"
else
  bad "login -> $STATUS or missing token. Body: $BODY"
fi

# 3. Authenticated usage endpoint --------------------------------------------
if [ -n "$TOKEN" ]; then
  request GET "$API_URL/api/usage" "" "$TOKEN"
  if [ "$STATUS" = "200" ]; then
    ok "/api/usage (authed) -> 200"
  else
    bad "/api/usage -> $STATUS (expected 200). Body: $BODY"
  fi
else
  bad "/api/usage skipped — no auth token from register/login"
fi

# 4. Frontend serves the SPA --------------------------------------------------
request GET "$BASE_URL/"
if [ "$STATUS" = "200" ] && printf '%s' "$BODY" | grep -qi 'markivo'; then
  ok "frontend / -> 200 and mentions Markivo"
else
  bad "frontend / -> $STATUS or page does not mention 'Markivo'"
fi

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
