# Error handling

How to fail correctly in this codebase: which error to throw, which status the client gets, and what
the response body looks like. Every rule here is enforced by a test — the file to change is named
next to each one.

## The one rule

**Throw `DomainException`. Never build an error body, never pick an HTTP status in a handler.**

```ts
import { DomainException } from '@nestjs-fastify-nx/core';
import { ERROR_CODES, I18N_KEYS } from '@nestjs-fastify-nx/contracts';

throw new DomainException({
  kind: 'not_found',
  code: ERROR_CODES.USER_NOT_FOUND,
  title: I18N_KEYS.common.not_found,
  messageKey: I18N_KEYS.errors.users.not_found,
  violations: [
    {
      path: 'userId',
      code: 'not_found',
      message: 'User not found',
      messageKey: I18N_KEYS.errors.users.not_found,
    },
  ],
});
```

`DomainException` is a plain `Error`. It carries **no HTTP status**, because the same command and
query handlers run under REST, GraphQL and the scheduler's outbox listener — only the transport
knows what "not found" means on the wire.

## Choosing `kind`

`kind` is the only decision a handler makes. The transport derives everything else.

| `kind`       | Status | Use when                                                                                          | Do not use when                                                                         |
| ------------ | ------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `malformed`  | `400`  | The input could not be parsed at all — an opaque cursor that will not decode, an unreadable token | A field parsed fine but is out of range — that is `validation`                          |
| `validation` | `422`  | Input parsed but broke a rule the client can fix                                                  | The whole payload is unreadable — that is `malformed`                                   |
| `not_found`  | `404`  | The resource does not exist, or the caller must not learn that it does                            | The caller is simply not allowed — that is `forbidden`, unless hiding existence matters |
| `conflict`   | `409`  | State conflict: duplicate key, stale version, work already in flight                              | A rule violation with no competing state — that is `validation`                         |
| `forbidden`  | `403`  | Authenticated but not permitted                                                                   | Not authenticated at all — that is the guard's `401`, not a domain error                |

`malformed` vs `validation` is the RFC 9110 §15.5 distinction and the reason both exist: 400 means
"I could not understand the request", 422 means "I understood it and it is wrong".

Verified by `apps/api/src/common/filters/global-exception-filter-redaction.spec.ts`.

## `permanent` — the flag consumers outside HTTP rely on

```ts
new DomainException({ kind: 'conflict', permanent: false, violations: [...] });
```

Defaults to `true`. A rejected business rule does not become valid by waiting, so any consumer that
retries must stop immediately instead of burning its budget:

- `OutboxRelayService` parks the row at `maxAttempts` on a permanent failure instead of retrying it
  ten times across ~13 minutes of backoff.
- Set `permanent: false` only for a conflict a later attempt could genuinely win.

Verified by `libs/core/src/lib/errors/domain.exception.spec.ts` and the outbox relay specs.

## `code` must exist in `ERROR_CODES`

`libs/contracts/src/lib/errors/error-codes.ts` is the stable contract the client keys its
translations off. Adding an ad-hoc string there means the client renders an untranslated code.
Add the constant first, then use it.

## What the client receives

RFC 9457 `application/problem+json`, emitted by `GlobalExceptionFilter`. Nothing else builds an
error body.

The `type` URI resolves: `GET /errors/<slug>` returns a page explaining what the code means and what
the client should do, and `GET /errors` lists every type. The pages are generated from
`ERROR_CATALOG` in `libs/contracts`, and a unit test fails if a value in `ERROR_CODES` has no entry —
so a new code cannot ship undocumented.

```json
{
  "type": "/errors/invalid-cursor",
  "title": "The request is malformed or missing required data.",
  "status": 400,
  "detail": "startingAfter is not a valid cursor",
  "instance": "/api/v1/admin/users",
  "code": "invalid_cursor",
  "requestId": "f06e87102cb8fef9f4394375f29296fe",
  "timestamp": "2026-07-31T14:14:23.210Z",
  "errors": [
    {
      "path": "startingAfter",
      "code": "invalid_cursor",
      "message": "startingAfter is not a valid cursor",
      "messageKey": "errors.pagination.invalid_cursor"
    }
  ]
}
```

`title` and `detail` are translated per request locale when they are dotted i18n keys. `requestId`
is the value to quote in a bug report — it appears on every log line for that request.

## Status codes the server actually emits

| Status | Raised by                                                                                                                 | Documented by                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `400`  | `DomainException({ kind: 'malformed' })`, malformed JSON, bad headers                                                     | `ApiCommonErrors` (always)                        |
| `401`  | `BetterAuthGuard` — missing or invalid session cookie; `ApiKeyGuard` — unknown, revoked or expired key                    | `ApiCommonErrors({ auth: true })`                 |
| `403`  | `RolesGuard`, `PermissionGuard`, non-ACTIVE account, `DomainException({ kind: 'forbidden' })`                             | `ApiCommonErrors` (implied by `auth`)             |
| `404`  | `DomainException({ kind: 'not_found' })`, unmatched route                                                                 | `ApiCommonErrors({ notFound: true })`             |
| `409`  | `DomainException({ kind: 'conflict' })`, Prisma P2002/P2003, in-flight idempotent replay                                  | `ApiCommonErrors({ conflict: true })`             |
| `413`  | `@fastify/multipart` / body limit                                                                                         | `ApiCommonErrors({ payloadTooLarge: true })`      |
| `415`  | Content-Type with no registered parser                                                                                    | `ApiCommonErrors({ unsupportedMediaType: true })` |
| `422`  | `ProblemDetailsValidationPipe`, `DomainException({ kind: 'validation' })`, `Idempotency-Key` reused with a different body | `ApiCommonErrors({ validation: true })`           |
| `429`  | `@fastify/rate-limit` (auth routes), `ThrottlerGuard`                                                                     | `ApiCommonErrors` (always)                        |
| `500`  | Anything unhandled — always generic, never echoes the cause                                                               | `ApiCommonErrors` (always)                        |
| `501`  | `NotImplementedException` — what a freshly generated repository throws                                                    | status map fallback                               |
| `503`  | `@fastify/under-pressure` load shedding, failed health probe                                                              | `ApiCommonErrors` (always)                        |
| `504`  | `TimeoutInterceptor` past `HTTP_REQUEST_TIMEOUT_MS`                                                                       | `ApiCommonErrors` (always)                        |

`503` and `504` are on every route because both come from process-wide mechanisms, not from any
handler. Health probes opt out of the generic `503` (`serviceUnavailable: false`) because they
document a richer one carrying a `checks` breakdown.

Note: an unmatched **method** on an existing path answers `404`, not `405` — that is Fastify's
router default and this project does not override it.

## Domain codes by area

`code` is the value a client keys its i18n and its retry logic off, so it must come from
`ERROR_CODES` (`libs/contracts`) and never be an ad-hoc string. Every code below is documented at
`GET /errors/<slug>` — the same URI the `type` member points at — and `error-catalog.spec.ts` fails
if a code exists without a doc entry or the other way round.

| Area             | Codes                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Users            | `user_not_found`, `user_already_exists`, `organization_context_required`                                                |
| Organizations    | `organization_not_found`, `organization_role_not_found`, `organization_role_already_exists`, `organization_role_in_use` |
| Teams            | `team_not_found`, `team_name_taken`                                                                                     |
| Invitations      | `invitation_not_found`, `invitation_not_pending`                                                                        |
| API keys         | `api_key_not_found`, `api_key_invalid_credential`, `api_key_scope_exceeds_grant`                                        |
| Notifications    | `notification_not_found`                                                                                                |
| Feature flags    | `feature_flag_not_found`, `feature_flag_key_taken`                                                                      |
| Terms            | `term_not_found`, `term_not_published`, `term_version_taken`                                                            |
| Sessions         | `session_not_found`                                                                                                     |
| Audit log        | `invalid_audit_log_id`                                                                                                  |
| Pagination       | `invalid_cursor`                                                                                                        |
| Upload / storage | `upload_*`, `storage_*`                                                                                                 |
| Idempotency      | `idempotency_key_invalid`, `idempotency_key_conflict`, `idempotency_key_mismatch`                                       |

Two of these carry a decision worth knowing:

- **`api_key_scope_exceeds_grant` (422)** — a key may never carry a permission its issuer does not
  hold, otherwise `api_key:create` silently becomes a grant of the entire catalog.
- **`organization_role_in_use` (409)** — deleting a role that members still hold would strip their
  permissions with no audit trail, so it is refused until they are reassigned.

## Answering `404` where `403` would be truthful

Several handlers return `not_found` for a resource the caller is simply not allowed to see: a
notification addressed to another member, a session belonging to another user, a team in another
organization. A distinguishable `403` would confirm that the id exists, which is itself a leak.
Use `forbidden` when the caller may already know the resource exists (a permission they lack on
their own organization); use `not_found` when the answer would otherwise reveal existence.

## Never leak internals

Every `5xx` is generic in every environment, across Nest REST, Fastify-level errors, Better Auth,
GraphQL, WebSocket handshakes and Bull Board. The rules:

- A `5xx` body never carries the thrown message — the full cause goes to the structured log and
  Sentry under `requestId`.
- `errors[]` never echoes the rejected value.
- Response builders strip unknown extension fields (`stack`, `cause`, `internal`, `received`).
- Prisma errors are mapped by code (P2002/P2003→409, P2025→404, P2023→400, P2028/P2024→503); every
  other Prisma error becomes a generic 500.

Verified by `global-exception-filter-redaction.spec.ts` and `graphql-error-formatter.spec.ts`.

## Do not

- **Do not** `extends HttpException` in `libs/core`, a domain entity, or an application handler. It
  pins a transport-specific status onto code that also runs in the worker and scheduler.
- **Do not** hand-roll a response body, or set `X-Request-Id` yourself.
- **Do not** catch an error only to rethrow it as a generic one — the specific type is what lets the
  outbox park, GraphQL null out `me`, and the client act.
- **Do not** validate by hand in a handler. Body and query validation belong on the presentation DTO
  (`class-validator`); ids use `@Param('id', new ParseUUIDPipe({ version: '7' }))`.

## Other transports

- **GraphQL** — `graphql-error-formatter.ts` masks internal failures but passes a `DomainException`
  through, because it is raised for the client to read. Match on `err.kind`, never on a status.
- **Worker / scheduler** — no HTTP layer exists. A `DomainException` is caught by the outbox relay
  or the BullMQ processor, which log `code` and honour `permanent`.
- **Fastify-level** — errors raised before the Nest pipeline are normalised into the same
  problem+json shape by an `onSend` hook (`applyFastifyProblemDetailsHook`), not by a second error
  handler.
