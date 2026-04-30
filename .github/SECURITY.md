# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Instead, report privately via [GitHub Security Advisories](https://github.com/chuanghiduoc/nestjs-fastify-nx/security/advisories/new).

When reporting, please include:

- A description of the issue and its impact
- Steps to reproduce (PoC if possible)
- Affected versions / commits
- Any suggested mitigations

You should receive an acknowledgement within 72 hours. We aim to release a
fix within 14 days for high-severity issues.

## Scope

This boilerplate ships hardened defaults (Helmet CSP, rate limiting, secret
scanning, SBOM + SLSA provenance, Cosign signing). Issues in any of these
layers are in scope. Issues in upstream dependencies should be reported to
the respective project; this repo pins vulnerable transitive deps via
`pnpm.overrides` as a stop-gap.

## Disclosure

We follow coordinated disclosure. Once a fix is released, the advisory is
made public on GitHub and the CVE (if assigned) is published.
