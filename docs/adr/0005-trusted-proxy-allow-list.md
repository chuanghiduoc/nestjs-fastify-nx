# ADR-0005: Client IP resolution trusts an address allow-list, not a hop count

- **Status**: Accepted
- **Date**: 2026-08-25

## Context

`req.ip` decides which bucket every IP-keyed defence uses: the global throttler,
the two-tier `/api/auth/*` limiter, and the per-IP WebSocket connection lease.
When the API sits behind a reverse proxy, that address can only come from
`X-Forwarded-For`, which the client controls end-to-end. Whether a forwarded hop
is believable is therefore the whole security question.

Until now the answer was `TRUST_PROXY_HOPS`: an integer handed to Fastify's
`trustProxy` and mirrored in `ws-auth.adapter.ts` through a `proxy-addr` predicate
keyed on hop index. Fastify 5.12.0 removed `number` from the `trustProxy` type and
made it fail closed at runtime — a numeric value now trusts nothing — on the
grounds that a hop count cannot validate the immediate peer: a client that connects
directly and supplies enough forged hops is indistinguishable from a client behind
that many real proxies.

## Decision

`TRUST_PROXY_CIDRS` replaces `TRUST_PROXY_HOPS`. It is a comma-separated
allow-list of addresses, CIDR ranges, or `proxy-addr` presets (`loopback`,
`linklocal`, `uniquelocal`). Empty — the default — trusts no proxy and resolves
every client to its TCP peer address.

Both transports read the same list. HTTP passes it to `FastifyAdapter`'s
`trustProxy`; the WebSocket handshake passes it to `proxy-addr` in
`resolveClientIp`. Resolution walks in from the TCP peer and returns the first
address that is not in the list.

`apps/api/src/common/http/trusted-proxies.ts` owns parsing and validation, so
`main.ts` (which reads `process.env` before Nest boots) and `env.validation.ts`
cannot disagree about what a valid list is. An unparseable list is treated as
empty at adapter construction, which keeps the boot failure a clean env
validation error rather than a `proxy-addr` throw.

## Consequences

Operators must know their proxy topology by address, not by depth — a rollout
that only forwards `X-Forwarded-For` is no longer enough. A proxy left out of the
list makes `req.ip` the proxy address, collapsing every client behind it into one
rate-limit bucket; that failure is loud (one bucket, shared limits) rather than
silent, which is the intended direction.

Existing deployments that set `TRUST_PROXY_HOPS` to a non-zero value must migrate.
The variable is gone, so a stale value is inert: the API boots trusting nothing and
resolves clients to the proxy address. Deployments that never set it (the default
`0`) are unaffected.

We would know this was wrong if operators could not enumerate their proxy
addresses — typically a cloud load balancer with a rotating, undocumented egress
range. The escape hatch there is a preset (`uniquelocal`) or the provider's
published CIDR list, not a return to hop counting.

## Alternatives rejected

**Keep the hop count by reimplementing the index predicate ourselves.** It
compiles and preserves current behaviour, but it re-creates precisely the spoofing
gap upstream just closed, in code we would own instead of code Fastify maintains.

**Map any non-zero hop count to `trustProxy: true`.** One-line change, keeps
`X-Forwarded-For` working, and trusts every peer — the worst option available
whenever the API is reachable outside the proxy.

**Pin Fastify below 5.12.** Defers the migration at the cost of freezing a
security-relevant dependency, and the fix would still be needed on the next bump.
