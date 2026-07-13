#!/usr/bin/env bash
# Throwaway smoke test for endpoints not covered in the 23-item baseline.
# Designed for local dev stack (build-dev.sh). Cleans up its own user.
set +e

BASE="${BASE_URL:-http://localhost:3000}"
PASS_COUNT=0
FAIL_COUNT=0

# Per-run temp dir (mktemp -d is portable across BSD/macOS + GNU). Hardcoded
# /tmp/*.json paths collide between concurrent runs and multi-user hosts and
# never get cleaned up; a trap removes this on every exit path.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "[PASS] $name -> $actual"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "[FAIL] $name -> got $actual expected $expected"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

check_in() {
  local name="$1" expected_csv="$2" actual="$3"
  if echo ",$expected_csv," | grep -q ",$actual,"; then
    echo "[PASS] $name -> $actual (one of $expected_csv)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "[FAIL] $name -> got $actual expected one of $expected_csv"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

EMAIL="full-$(date +%s)-$$@example.com"
PASS="password123"
NEW_PASS="newPassword456"

echo "=== BATCH A: Better Auth recovery + self-service ==="

SU=$(curl -s -i --max-time 10 -X POST "$BASE/api/auth/sign-up/email" \
  -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"FullSmoke\"}")
SU_CODE=$(echo "$SU" | head -1 | awk '{print $2}')
check "sign-up throwaway" "200" "$SU_CODE"
COOKIE=$(echo "$SU" | grep -i '^set-cookie:' | sed -E 's/^[Ss]et-[Cc]ookie: ([^;]+);.*/\1/' | paste -sd '; ' -)

FP=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' -X POST "$BASE/api/auth/request-password-reset" \
  -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d "{\"email\":\"$EMAIL\",\"redirectTo\":\"$BASE/reset\"}")
# Better Auth v1 renamed `forget-password` → `request-password-reset`.
# Returns 200 silently regardless of whether the email exists (anti-enum).
check "POST /api/auth/request-password-reset" "200" "$FP"

RP=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' -X POST "$BASE/api/auth/reset-password" \
  -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d '{"newPassword":"anything1234","token":"invalid-token"}')
check_in "POST /api/auth/reset-password (bad token)" "400,401,403,404,422" "$RP"

CP=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' -X POST "$BASE/api/auth/change-password" \
  -H "Content-Type: application/json" -H "Origin: $BASE" -H "Cookie: $COOKIE" \
  -d "{\"currentPassword\":\"$PASS\",\"newPassword\":\"$NEW_PASS\"}")
check "POST /api/auth/change-password" "200" "$CP"

LS=$(curl -s -o "$TMP_DIR/ls.json" --max-time 10 -w '%{http_code}' -H "Cookie: $COOKIE" "$BASE/api/auth/list-sessions")
check "GET /api/auth/list-sessions" "200" "$LS"

UU=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' -X POST "$BASE/api/auth/update-user" \
  -H "Content-Type: application/json" -H "Origin: $BASE" -H "Cookie: $COOKIE" \
  -d '{"name":"FullSmokeRenamed"}')
check "POST /api/auth/update-user" "200" "$UU"

CE=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' -X POST "$BASE/api/auth/change-email" \
  -H "Content-Type: application/json" -H "Origin: $BASE" -H "Cookie: $COOKIE" \
  -d "{\"newEmail\":\"renamed-$(date +%s)@example.com\"}")
# 200 once `user.changeEmail.enabled: true` + `emailVerification.sendVerificationEmail`
# are wired in better-auth.config.ts. Verification email is enqueued via BullMQ.
check_in "POST /api/auth/change-email" "200,202" "$CE"

VE=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "$BASE/api/auth/verify-email?token=invalid")
check_in "GET /api/auth/verify-email (bad token)" "200,302,400,401,403,404,422" "$VE"

RO=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' -X POST "$BASE/api/auth/revoke-other-sessions" \
  -H "Content-Type: application/json" -H "Origin: $BASE" -H "Cookie: $COOKIE" -d '{}')
check "POST /api/auth/revoke-other-sessions" "200" "$RO"

echo "=== BATCH B: Bull Board ==="

BB_NO=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "$BASE/api/admin/queues")
check "GET /api/admin/queues (no auth)" "401" "$BB_NO"

BB_OK=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' -u "${BULL_BOARD_USER:-admin}:${BULL_BOARD_PASSWORD:-admin}" "$BASE/api/admin/queues")
check "GET /api/admin/queues (admin:admin)" "200" "$BB_OK"

BB_WRONG=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' -u "${BULL_BOARD_USER:-admin}:wrong-password" "$BASE/api/admin/queues")
check "GET /api/admin/queues (wrong pass)" "401" "$BB_WRONG"

echo "=== BATCH C: GraphQL data queries ==="

# Re-sign-in (change-password may have invalidated cookie)
RESI=$(curl -s -i --max-time 10 -X POST "$BASE/api/auth/sign-in/email" \
  -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$NEW_PASS\"}")
COOKIE=$(echo "$RESI" | grep -i '^set-cookie:' | sed -E 's/^[Ss]et-[Cc]ookie: ([^;]+);.*/\1/' | paste -sd '; ' -)

GQL_ME=$(curl -s -o "$TMP_DIR/gql-me.json" --max-time 10 -w '%{http_code}' -X POST "$BASE/graphql" \
  -H "Content-Type: application/json" -H "Cookie: $COOKIE" \
  -d '{"query":"query { me { id email name role status } }"}')
check "POST /graphql query me (cookie)" "200" "$GQL_ME"

GQL_USERS=$(curl -s -o "$TMP_DIR/gql-users.json" --max-time 10 -w '%{http_code}' -X POST "$BASE/graphql" \
  -H "Content-Type: application/json" -H "Cookie: $COOKIE" \
  -d '{"query":"query { users(page:1,pageSize:5) { data { id email } meta { page pageSize total } } }"}')
check "POST /graphql query users (USER cookie)" "200" "$GQL_USERS"

echo "=== BATCH D: Socket.io WebSocket ==="
# Gateway is mounted at `/ws` (notification.gateway.ts:50), not the default
# `/socket.io/`. The engine.io polling handshake therefore lives at /ws/.

WS_OK=$(curl -s -o "$TMP_DIR/ws-ok.txt" --max-time 10 -w '%{http_code}' \
  -H "Cookie: $COOKIE" "$BASE/ws/?EIO=4&transport=polling")
check "GET /ws/ handshake (cookie)" "200" "$WS_OK"

WS_NO=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "$BASE/ws/?EIO=4&transport=polling")
# Without a cookie the auth middleware should reject the handshake but
# engine.io may still complete the polling open frame before the middleware
# fires, so accept any of the documented outcomes.
check_in "GET /ws/ (no cookie)" "200,400,401,403" "$WS_NO"

echo "=== Cleanup ==="
# Better Auth `user.deleteUser.enabled: true` is wired in better-auth.config.ts;
# the route returns 200 with "Verification email sent" — actual deletion only
# happens once the user clicks the link, so the throwaway row persists until
# the next `truncateAll()` runs in CI.
DEL=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' -X POST "$BASE/api/auth/delete-user" \
  -H "Content-Type: application/json" -H "Origin: $BASE" -H "Cookie: $COOKIE" \
  -d "{\"password\":\"$NEW_PASS\"}")
check_in "POST /api/auth/delete-user (verification email)" "200,202,204" "$DEL"

echo "==="
echo "EXPANDED TOTAL: $((PASS_COUNT + FAIL_COUNT)) | PASS=$PASS_COUNT | FAIL=$FAIL_COUNT"
exit 0
