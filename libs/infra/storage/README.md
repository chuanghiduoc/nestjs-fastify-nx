# infra-storage

Object storage adapter — S3 SDK v3 with presigned URLs, MinIO-compatible in
dev. The application talks to a `StoragePort` interface; the concrete S3
implementation is owned by this lib.

**Tag**: `scope:infra`.

## Public API

```ts
import {
  StorageModule,
  STORAGE_PORT,
  type StoragePort,
  type StoredFile,
  type UploadOptions,
} from '@nestjs-fastify-nx/infra-storage';
```

| Export          | Purpose                                                       |
| --------------- | ------------------------------------------------------------- |
| `StorageModule` | Global NestJS module — registers the S3 client + adapter      |
| `STORAGE_PORT`  | DI token; inject as `@Inject(STORAGE_PORT) port: StoragePort` |
| `StoragePort`   | Interface: `upload`, `delete`, `getSignedUrl`, `exists`       |
| `StoredFile`    | Result envelope (`key`, `bucket`, `etag`, `size`)             |
| `UploadOptions` | Per-upload knobs (content type, ACL, metadata)                |

## Why a port?

Domain and application code never reference S3 SDK types directly — they
depend on `StoragePort`. Swapping S3 for GCS or local disk is a single-file
change in this lib, and tests can substitute an in-memory implementation
without touching Nest's DI tree.

The `upload` controller in `apps/api` is the only direct consumer; feature
modules that need persistence (e.g. attaching a file to a domain entity)
inject `STORAGE_PORT` and store the returned `key`.

## Configuration

All settings come from environment variables:

| Variable             | Default                 | Notes                  |
| -------------------- | ----------------------- | ---------------------- |
| `STORAGE_ENDPOINT`   | `http://localhost:9000` | S3-compatible endpoint |
| `STORAGE_ACCESS_KEY` | `minioadmin`            | Rotate in production   |
| `STORAGE_SECRET_KEY` | `minioadmin`            | Rotate in production   |
| `STORAGE_BUCKET`     | `uploads`               | Default bucket name    |
| `STORAGE_REGION`     | `us-east-1`             | S3 region              |

In dev, MinIO runs as a Docker service with the console at
[http://localhost:9001](http://localhost:9001).
