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
  type ObjectMetadata,
  type PresignedUpload,
  type PresignUploadOptions,
} from '@nestjs-fastify-nx/infra-storage';
```

| Export                 | Purpose                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `StorageModule`        | Registers the S3 client + adapter. Not `@Global` — import it where you need it                      |
| `STORAGE_PORT`         | DI token; inject as `@Inject(STORAGE_PORT) port: StoragePort`                                       |
| `StoragePort`          | Interface: `upload`, `presignUpload`, `head`, `getSignedUrl`, `delete`, `finalize`, `readRange`     |
| `StoredFile`           | Result envelope (`key`, `url`, `bucket`, `size`)                                                    |
| `UploadOptions`        | Per-upload knobs (`bucket`, `contentType`, `metadata`)                                              |
| `ObjectMetadata`       | What `head()` returns (`contentType`, `size`, `bucket`, `etag`) — `null` when the object is missing |
| `PresignedUpload`      | Presigned POST policy (`url`, `fields`, `key`, `bucket`, `expiresAt`, `maxBytes`)                   |
| `PresignUploadOptions` | Policy inputs (`contentType`, `maxBytes`, optional `bucket`/`expiresInSeconds`)                     |

## Why a port?

Domain and application code never reference S3 SDK types directly — they
depend on `StoragePort`. Swapping S3 for GCS or local disk is a single-file
change in this lib, and tests can substitute an in-memory implementation
without touching Nest's DI tree.

Three places inject `STORAGE_PORT` today: the upload controller
(`libs/modules/upload`) issues policies and confirms objects, the worker's
`upload-verification.processor` re-reads magic bytes off the final object, and
the scheduler's `stored-file-cleanup.task` deletes abandoned ones. Feature
modules that attach a file to a domain entity do the same and store the
returned `key`.

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
