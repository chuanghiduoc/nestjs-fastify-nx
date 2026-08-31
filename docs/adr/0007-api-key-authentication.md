# ADR-0007: API keys are hashed bearer credentials, and routes opt into them

- **Status**: Accepted
- **Date**: 2026-08-31

## Context

Every integration a customer builds — a CI job, a nightly export, a partner
backend — needs to call the API without a browser. The session model cannot
serve them: Better Auth cookies are minted for an interactive sign-in, are tied
to a person, and expire on a schedule tuned for humans.

`AuthorizationPort` already modelled a non-human caller (`Principal.type ===
'api_key'`, carrying `scopes` and an `organizationId`), and both adapters
resolved it. Nothing could produce one, so the branch was unreachable code.

Two forces shape the design:

1. A key is a **bearer credential in plaintext at rest on the client**. Whatever
   we store must not let a database leak become an authentication bypass.
2. A key has **no user behind it**. Any handler that reads `@CurrentUser()`
   would be acting on a session that does not exist.

## Decision

### Storage: SHA-256 of the raw key, never the key

`generateApiKey()` (`libs/shared/src/lib/api-key.ts`) mints
`sk_<base64url(32 random bytes)>`. The database stores the SHA-256 digest, a
non-secret `prefix` (`sk_` plus 8 characters) for telling keys apart in a list,
and nothing else. The raw value is returned once, in the creation response.

SHA-256 rather than bcrypt/argon2 **because the secret has 256 bits of entropy**.
Password hashes are slow to defeat dictionary attacks on low-entropy human
input; there is no dictionary for a random 32-byte key, so the slow hash buys
nothing and costs a per-request KDF. It also lets verification be a single
indexed lookup on `api_keys.keyHash` instead of a scan-and-compare.

### Scope ceiling: a key can never exceed its issuer

`ApiKey.issue()` takes the permissions the calling member actually holds and
refuses any requested scope outside them (`api_key_scope_exceeds_grant`, 422).
Without this, `api_key:create` would silently be a grant of every permission in
the catalog.

### Routes opt in with `@AllowApiKey()`

`ApiKeyGuard` runs before `BetterAuthGuard`. When a key is presented to a route
that has not opted in, it is refused **before the database lookup** — so the
response cannot confirm whether the key exists, and no handler expecting a
session is ever reached. A route that opts in must read its tenant through
`resolveOrganizationId(user, apiKey)`: the key carries the organization it was
issued for, and there is no active-organization on a session that does not
exist.

### Revocation is a timestamp, checked on every request

`revokedAt` and `expiresAt` are evaluated at verification time, so revoking
takes effect on the next request with no cache to invalidate. Revoking an
already-revoked key is a no-op: the caller's intent ("this key must not work")
already holds, and a retried DELETE must stay safe.

`lastUsedAt` is written fire-and-forget. It is telemetry; awaiting it would put
a write on the hot path of every machine request, and its failure must never
fail the request it describes.

## Consequences

- A lost key is unrecoverable by design. The remedy is to issue a new one and
  revoke the old — there is no "show key again" endpoint to build.
- Verification costs one indexed lookup per request. If that becomes hot, the
  answer is a short-TTL cache keyed by digest, with revocation accepting the
  TTL as its worst-case delay — not a weaker hash.
- The opt-in list is a real maintenance surface: a new machine-reachable route
  has to add `@AllowApiKey()` and take its tenant from the key. That is
  deliberate — the failure mode of forgetting is a refused key, not a handler
  dereferencing a session that is not there.
- Keys are organization-scoped, so a customer with several organizations needs
  one key per organization. Cross-organization keys would need a second scope
  axis and are not modelled.

## Alternatives rejected

- **bcrypt/argon2 for the digest.** Buys nothing against a 256-bit random
  secret, and forces every request through a deliberately slow KDF. The
  protection a password hash provides is against low-entropy inputs.
- **Reusing the session table with a long-lived token.** Would make a machine
  credential indistinguishable from a person's session in audit and revocation
  paths, and would inherit user status/role checks a machine has no answer for.
- **Letting a key act on any permission-gated route.** Rejected: handlers that
  read `@CurrentUser()` would receive `undefined`, turning a missing session
  into a runtime error rather than an authorization decision.
- **Storing the key encrypted so it can be shown again.** An encrypted key is
  recoverable by whoever holds the key-encryption key, which puts the secret
  back in the blast radius of a database leak — the exact property hashing
  exists to remove.
