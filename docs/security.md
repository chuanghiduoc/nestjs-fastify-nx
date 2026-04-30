# Security scanning

Defense-in-depth pipeline covering source, dependencies, code, images, and
supply-chain provenance. Every layer runs both **locally** (developer feedback)
and in **CI** (gate). A clean local run mirrors the CI gate.

## Layers

| #   | Layer          | Tool          | Local script                       | CI workflow                            |
| --- | -------------- | ------------- | ---------------------------------- | -------------------------------------- |
| 1   | Secrets        | Gitleaks      | `scripts/security/scan-secrets.sh` | `ci.yml` (`secret-scan` job, lefthook) |
| 2   | Dependencies   | OSV-Scanner   | `scripts/security/scan-deps.sh`    | `ci.yml` (`dep-scan` job)              |
| 2   | Dependencies   | `pnpm audit`  | (built-in)                         | `ci.yml` (main job)                    |
| 3   | SAST           | Semgrep       | `scripts/security/scan-sast.sh`    | `release.yml` (`static-analysis`)      |
| 4   | Container CVEs | Trivy         | `scripts/security/scan-images.sh`  | `release.yml` (`security-scan`)        |
| 5   | Supply chain   | Cosign + SLSA | `scripts/security/sign-images.sh`  | `release.yml` (sign step)              |

Run the whole stack locally: `./scripts/security/scan-all.sh`.

## What each tool catches

### Gitleaks — secrets

API keys, tokens, private keys committed to the repo. Pre-commit hook scans
staged hunks; pre-push hook scans full history; CI scans the entire diff.

```bash
./scripts/security/scan-secrets.sh           # full repo + history
./scripts/security/scan-secrets.sh --staged  # what pre-commit runs
./scripts/security/scan-secrets.sh --no-git  # filesystem only (skips .git)
```

False positives go in `.gitleaksignore` (one fingerprint per line).

### OSV-Scanner — dependency CVEs

Reads `pnpm-lock.yaml` directly so transitive resolutions match what's
installed. Uses the OSV.dev advisory feed which aggregates GitHub Security
Advisories, GHSA, NVD, language ecosystems (npm, PyPI, Maven, …) and OS
package advisories. Complements `pnpm audit` (npm registry only) and Trivy
(image-level).

```bash
./scripts/security/scan-deps.sh
```

### Semgrep — SAST

Pattern-based static analysis tuned for this stack:

- `p/typescript`, `p/nodejs`, `p/javascript`
- `p/owasp-top-ten`, `p/jwt`, `p/sql-injection`, `p/xss`, `p/command-injection`
- `p/secrets` (AST-level secret heuristics — backstops Gitleaks)
- `p/dockerfile`, `p/ci`

```bash
./scripts/security/scan-sast.sh           # gate on ERROR
./scripts/security/scan-sast.sh --audit   # show WARNING/INFO too
```

### Trivy — image CVEs

Same engine + DB as `release.yml`, so a clean local scan implies a clean CI
scan. Scope: OS packages (Alpine APK), language packages (npm), and known
misconfigurations.

```bash
./scripts/security/scan-images.sh                # all four images
./scripts/security/scan-images.sh api            # subset
TRIVY_EXIT_CODE=0 ./scripts/security/scan-images.sh   # warn-only
```

The `build-prod.sh` script gates on this by default. `build-dev.sh` runs
Trivy too but warn-only — dev images carry devDeps so the noise floor is high.

### Cosign — supply-chain signatures

Production images are signed with **keyless OIDC** via Sigstore Fulcio in
`release.yml`. No long-lived signing keys; identity is the workflow ref +
GitHub actor, recorded in the public Rekor transparency log.

Verify a published tag locally:

```bash
COSIGN_IDENTITY="https://github.com/<org>/<repo>/.github/workflows/release.yml@refs/tags/v1.2.3" \
COSIGN_OIDC_ISSUER="https://token.actions.githubusercontent.com" \
IMAGE_NAMESPACE="<org>/<repo>" IMAGE_TAG="v1.2.3" \
./scripts/security/sign-images.sh verify
```

Combined with the SBOM + max-mode provenance attestations the build emits,
this produces a SLSA-3-compatible chain: every deployed digest can be traced
back to a specific commit, workflow run, and signing identity.

## Local developer workflow

```bash
# One-shot full audit (no images required)
./scripts/security/scan-all.sh

# Just the fast checks before pushing
./scripts/security/scan-secrets.sh
./scripts/security/scan-deps.sh

# After building production images
./scripts/build-prod.sh    # gates Trivy automatically
```

Lefthook wires Gitleaks into `pre-commit` (staged hunks) and `pre-push`
(full history). To run hooks manually:

```bash
pnpm exec lefthook run pre-commit
pnpm exec lefthook run pre-push
```

## CI flow

```
PR / push
  ├── secret-scan        (gitleaks-action)
  ├── dep-scan           (osv-scanner-action)
  └── main               (lint, typecheck, test, build, pnpm audit)

tag v*.*.*
  ├── build-and-push     (buildx + SBOM + provenance attestations)
  │     └── cosign sign  (keyless via Fulcio OIDC)
  ├── security-scan      (Trivy SARIF → GitHub Security)
  ├── static-analysis    (Semgrep, error-only gate)
  └── migrate-and-deploy (gated on the four above)
```

## Tuning

| Variable           | Purpose                                | Default          |
| ------------------ | -------------------------------------- | ---------------- |
| `TRIVY_VERSION`    | Pin Trivy image                        | `0.62.0`         |
| `TRIVY_SEVERITY`   | Severities Trivy gates on              | `HIGH,CRITICAL`  |
| `TRIVY_EXIT_CODE`  | `0` = warn-only, `1` = gate            | `1`              |
| `TRIVY_CACHE`      | Trivy DB cache directory               | `~/.cache/trivy` |
| `GITLEAKS_VERSION` | Pin Gitleaks image                     | `v8.21.2`        |
| `GITLEAKS_CONFIG`  | Custom rules file (path inside repo)   | (built-in)       |
| `SEMGREP_VERSION`  | Pin Semgrep image                      | `1.99.0`         |
| `OSV_VERSION`      | Pin OSV-Scanner image                  | `v2.0.2`         |
| `COSIGN_VERSION`   | Pin Cosign image                       | `v2.4.1`         |
| `COSIGN_IDENTITY`  | Expected signing identity for `verify` | (required)       |

## Container hardening reference

Per-service Dockerfile properties relied on by the scanners above:

- Pinned base image by SHA256 digest (rebuilds reproducible, immune to
  tag mutation).
- Non-root user (UID 1001), `STOPSIGNAL SIGTERM`, tini PID 1.
- Multi-stage build — only pruned production node_modules + compiled JS in
  the final layer; no `node_modules` ever copied from the host
  (`.dockerignore` enforces this).
- npm CLI vendored by the Node Alpine base is removed in the production
  stage — strips the upstream picomatch CVE that `pnpm.overrides` cannot
  reach.
- HEALTHCHECK uses `node`'s built-in `http` module instead of `wget`,
  removing one binary and its CVE surface.
- OCI labels (`org.opencontainers.image.*`) populated for registry, scanner,
  and policy-engine consumption.
