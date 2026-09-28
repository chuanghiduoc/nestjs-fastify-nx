#!/bin/sh
set -eu

: "${GARAGE_ADMIN_TOKEN:?required}"
: "${STORAGE_BUCKET:?required}"
: "${STORAGE_ACCESS_KEY:?required}"
: "${STORAGE_SECRET_KEY:?required}"
: "${STORAGE_ORPHAN_EXPIRY_DAYS:?required}"

ADMIN_URL="${GARAGE_ADMIN_URL:-http://garage:3903}"
S3_URL="${GARAGE_S3_URL:-http://garage:3900}"
S3_REGION=us-east-1
ORPHAN_PREFIX=uploads/
LAYOUT_ZONE=dc1
LAYOUT_CAPACITY_BYTES=1000000000000
READY_ATTEMPTS=30
READY_DELAY_SECONDS=2
RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$RESPONSE_FILE"' EXIT

fail() {
  echo "garage-init: $*" >&2
  exit 1
}

matches() {
  printf '%s' "$1" | grep -Eq "$2"
}

validate_inputs() {
  matches "$STORAGE_ACCESS_KEY" '^GK[0-9a-f]{24}$' ||
    fail "STORAGE_ACCESS_KEY must be 'GK' followed by 24 lowercase hex chars — run ./scripts/gen-env.sh"
  matches "$STORAGE_SECRET_KEY" '^[0-9a-f]{64}$' ||
    fail "STORAGE_SECRET_KEY must be 64 lowercase hex chars — run ./scripts/gen-env.sh"
  matches "$STORAGE_ORPHAN_EXPIRY_DAYS" '^[1-9][0-9]*$' ||
    fail "STORAGE_ORPHAN_EXPIRY_DAYS must be a positive integer"
}

admin() {
  method="$1"
  endpoint="$2"
  body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer ${GARAGE_ADMIN_TOKEN}" -H 'Content-Type: application/json' \
      --data "$body" "${ADMIN_URL}/v2/${endpoint}"
  else
    curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer ${GARAGE_ADMIN_TOKEN}" "${ADMIN_URL}/v2/${endpoint}"
  fi
}

expect_status() {
  actual="$1"
  expected="$2"
  action="$3"
  [ "$actual" = "$expected" ] || fail "${action} failed (HTTP ${actual}): $(cat "$RESPONSE_FILE")"
}

top_level_field() {
  sed -n "s/^  \"$1\": \"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\}$/\1/p" "$RESPONSE_FILE" | head -n 1
}

wait_for_health() {
  wanted="$1"
  attempt=1
  while [ "$attempt" -le "$READY_ATTEMPTS" ]; do
    status="$(curl -s -o /dev/null -w '%{http_code}' "${ADMIN_URL}/health" || true)"
    if matches "$status" "$wanted"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep "$READY_DELAY_SECONDS"
  done
  fail "garage admin API never answered ${wanted} on /health (last: ${status})"
}

ensure_layout() {
  expect_status "$(admin GET GetClusterLayout)" 200 "GetClusterLayout"
  if ! grep -q '^  "roles": \[\]' "$RESPONSE_FILE"; then
    return 0
  fi
  current_version="$(top_level_field version)"
  expect_status "$(admin GET GetClusterStatus)" 200 "GetClusterStatus"
  node_id="$(sed -n 's/^      "id": "\([0-9a-f]*\)",$/\1/p' "$RESPONSE_FILE" | head -n 1)"
  [ -n "$node_id" ] || fail "GetClusterStatus returned no node id"
  expect_status "$(admin POST UpdateClusterLayout \
    "{\"roles\":[{\"id\":\"${node_id}\",\"zone\":\"${LAYOUT_ZONE}\",\"capacity\":${LAYOUT_CAPACITY_BYTES},\"tags\":[]}]}")" \
    200 "UpdateClusterLayout"
  expect_status "$(admin POST ApplyClusterLayout "{\"version\":$((current_version + 1))}")" \
    200 "ApplyClusterLayout"
  echo "garage-init: assigned single-node layout to ${node_id}"
}

ensure_key() {
  status="$(admin GET "GetKeyInfo?id=${STORAGE_ACCESS_KEY}&showSecretKey=true")"
  case "$status" in
    200)
      grep -q "\"secretAccessKey\": \"${STORAGE_SECRET_KEY}\"" "$RESPONSE_FILE" ||
        fail "key ${STORAGE_ACCESS_KEY} exists with a different secret; Garage cannot re-import an id, so rotate by issuing a new STORAGE_ACCESS_KEY"
      ;;
    404)
      expect_status "$(admin POST ImportKey \
        "{\"accessKeyId\":\"${STORAGE_ACCESS_KEY}\",\"secretAccessKey\":\"${STORAGE_SECRET_KEY}\",\"name\":\"app-storage\"}")" \
        200 "ImportKey"
      ;;
    *) expect_status "$status" 200 "GetKeyInfo" ;;
  esac
}

ensure_bucket() {
  status="$(admin GET "GetBucketInfo?globalAlias=${STORAGE_BUCKET}")"
  if [ "$status" = 404 ]; then
    status="$(admin POST CreateBucket "{\"globalAlias\":\"${STORAGE_BUCKET}\"}")"
  fi
  expect_status "$status" 200 "resolve bucket ${STORAGE_BUCKET}"
  bucket_id="$(top_level_field id)"
  [ -n "$bucket_id" ] || fail "bucket ${STORAGE_BUCKET} response carried no id"
  expect_status "$(admin POST AllowBucketKey \
    "{\"bucketId\":\"${bucket_id}\",\"accessKeyId\":\"${STORAGE_ACCESS_KEY}\",\"permissions\":{\"read\":true,\"write\":true,\"owner\":false}}")" \
    200 "AllowBucketKey"
}

apply_orphan_expiry() {
  body="<LifecycleConfiguration><Rule><ID>expire-orphan-uploads</ID><Status>Enabled</Status><Filter><Prefix>${ORPHAN_PREFIX}</Prefix></Filter><Expiration><Days>${STORAGE_ORPHAN_EXPIRY_DAYS}</Days></Expiration></Rule></LifecycleConfiguration>"
  content_md5="$(printf '%s' "$body" | md5sum | cut -d ' ' -f 1 | xxd -r -p | base64)"
  status="$(curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' -X PUT \
    --aws-sigv4 "aws:amz:${S3_REGION}:s3" --user "${STORAGE_ACCESS_KEY}:${STORAGE_SECRET_KEY}" \
    -H "Content-MD5: ${content_md5}" --data-binary "$body" \
    "${S3_URL}/${STORAGE_BUCKET}?lifecycle")"
  expect_status "$status" 200 "PutBucketLifecycleConfiguration"
}

validate_inputs
wait_for_health '^(200|503)$'
ensure_layout
wait_for_health '^200$'
ensure_key
ensure_bucket
apply_orphan_expiry
echo "garage-init: bucket ready: ${STORAGE_BUCKET} (key ${STORAGE_ACCESS_KEY}, read+write only, orphan expiry ${STORAGE_ORPHAN_EXPIRY_DAYS}d on ${ORPHAN_PREFIX})"
