#!/bin/sh
set -eu

: "${MINIO_ROOT_USER:?required}"
: "${MINIO_ROOT_PASSWORD:?required}"
: "${STORAGE_BUCKET:?required}"
: "${STORAGE_ACCESS_KEY:?required}"
: "${STORAGE_SECRET_KEY:?required}"
: "${MINIO_ORPHAN_EXPIRY_DAYS:?required}"

case "$MINIO_ORPHAN_EXPIRY_DAYS" in
  '' | *[!0-9]* | 0)
    echo "minio-init: MINIO_ORPHAN_EXPIRY_DAYS must be a positive integer" >&2
    exit 1
    ;;
esac

if [ "$STORAGE_ACCESS_KEY" = "$MINIO_ROOT_USER" ]; then
  echo "minio-init: STORAGE_ACCESS_KEY equals MINIO_ROOT_USER — apps would run on the root credential." >&2
  echo "minio-init: run ./scripts/gen-env.sh to issue a bucket-scoped key instead." >&2
  exit 1
fi

POLICY_NAME=app-storage
POLICY_FILE=/tmp/app-storage-policy.json

connected=0
for attempt in $(seq 1 15); do
  if mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; then
    connected=1
    break
  fi
  echo "waiting for minio... attempt ${attempt}" >&2
  sleep 2
done
[ "$connected" = 1 ] || {
  echo "minio-init: cannot reach minio after 30s" >&2
  exit 1
}

mc mb --ignore-existing "local/${STORAGE_BUCKET}"
mc ilm rule remove --all --force "local/${STORAGE_BUCKET}" 2>/dev/null || true
mc ilm rule add --expire-days "$MINIO_ORPHAN_EXPIRY_DAYS" --prefix 'uploads/' "local/${STORAGE_BUCKET}"

cat >"$POLICY_FILE" <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": ["arn:aws:s3:::${STORAGE_BUCKET}/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:ListBucketMultipartUploads", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::${STORAGE_BUCKET}"]
    }
  ]
}
POLICY

mc admin policy create local "$POLICY_NAME" "$POLICY_FILE"
mc admin user add local "$STORAGE_ACCESS_KEY" "$STORAGE_SECRET_KEY"

# `policy attach` exits non-zero when the binding already exists, which is the normal state on every
# redeploy. Every other failure still has to stop the one-shot.
if ! attach_output="$(mc admin policy attach local "$POLICY_NAME" --user "$STORAGE_ACCESS_KEY" 2>&1)"; then
  case "$attach_output" in
    *"already in effect"*) ;;
    *)
      echo "$attach_output" >&2
      exit 1
      ;;
  esac
fi

echo "bucket ready: ${STORAGE_BUCKET} (app key ${STORAGE_ACCESS_KEY} scoped to ${POLICY_NAME})"
