# ADR-0009: The bundled object store is Garage

- **Status**: Accepted
- **Date**: 2026-09-28

## Context

Every compose stack (dev, prod, swarm local test) bundled MinIO plus an `mc`
one-shot that created the bucket, a bucket-scoped app user and the orphan-expiry
lifecycle rule. MinIO withdrew its public images: Docker Hub stopped serving
`minio/minio` on 2026-09-12 and `quay.io/minio/*` answers 401 for every tag since
2026-09-24. The upstream repository was already archived. No compose file that
references MinIO can be pulled on a fresh host, so `docker-smoke` and every new
dev setup fail before the app starts.

The upload flow needs `PostObject` with a `content-length-range` policy,
`CopyObject` with `x-amz-copy-source-if-match`, `GetObject` with `Range`, and a
lifecycle `Expiration` filtered by the `uploads/` prefix. The apps must not hold
an administrative credential.

## Decision

Bundle Garage (`dxflrs/garage`, pinned by digest) as the S3 backend, single node,
`replication_factor = 1`, S3 region `us-east-1`. Its config file
`docker/garage/garage.toml` holds no secret; `GARAGE_RPC_SECRET` and
`GARAGE_ADMIN_TOKEN` arrive as environment variables and reach only the `garage`
and `garage-init` containers.

`garage-init` (`curlimages/curl`, pinned by digest) runs
`docker/garage/provision.sh` against the admin API v2. It assigns the single-node
layout when none exists, imports `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`,
creates `STORAGE_BUCKET`, grants the key `read` + `write` without `owner`, and
puts the orphan-expiry lifecycle rule over the S3 API with that key. Every step
is idempotent, so the one-shot runs on every boot.

Garage only accepts imported keys shaped `GK` + 24 hex chars with a 64-hex
secret, and never re-imports an id it has seen, even after deletion.
`gen-env.sh` generates that shape and replaces a pre-Garage key without
`--force`; `provision.sh` refuses a malformed key and refuses an existing id whose
secret differs, instead of leaving the apps on credentials that cannot sign.

## Consequences

Verified against a live Garage v2.4.1 with the app's own SDK clients: POST policy
size and content-type enforcement, `CopySourceIfMatch` refusing a stale ETag with
412, signed GET, CRC32 upload checksums, and `CreateBucket` refused for the app
key.

Garage has no IAM policy language. A `write` key can replace the bucket's
lifecycle configuration, which MinIO's bucket policy prevented. That is no wider
than the `DeleteObject` the key already needs.

There is no bundled web console; the MinIO console port (9001) is gone. The
`MINIO_*` variables are replaced by `GARAGE_PORT`, `GARAGE_RPC_SECRET`,
`GARAGE_ADMIN_TOKEN` and `STORAGE_ORPHAN_EXPIRY_DAYS`, and existing `.env` files
need `./scripts/gen-env.sh` once. A deployment already running the bundled MinIO
keeps its data in the old `minio_data` volume; moving it is an explicit copy
(`rclone sync` between the two endpoints) before switching, not something the
stack does.

Rotating the app secret means issuing a new `STORAGE_ACCESS_KEY` id, because
Garage will not re-import the old one.

## Alternatives rejected

- **A MinIO mirror (Chainguard, coollabs, bitnamilegacy).** Unblocks CI today,
  but pins the stack to an archived AGPL codebase that receives no security
  fixes, rebuilt by a third party that can withdraw it the same way.
- **SeaweedFS.** Supports the flow, but runs master, volume and filer roles and
  keeps identities in a static config file, which is more moving parts for a
  single-node default.
- **RustFS.** Pre-1.0 at the time of writing; a monitored pilot, not a default.
- **Dropping the bundled store and requiring external S3.** Makes the dev stack
  and `docker-smoke` depend on cloud credentials.
