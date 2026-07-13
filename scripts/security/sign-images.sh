#!/usr/bin/env bash
# Cosign — sign + attest production images.
#
# Two modes:
#   sign        signs images with Sigstore Fulcio (keyless OIDC). CI default.
#   verify      verifies signature + attestations against expected identity.
#   attest-sbom emits an in-toto SBOM attestation (Syft format) per image.
#
# Local dev: keyless OIDC requires interactive browser auth — usually you run
# `verify` only. CI provides ambient OIDC via `id-token: write`.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: ./scripts/security/sign-images.sh [ACTION] [APP...] [--help]"
  echo ""
  echo "Actions:"
  echo "  sign        Sign images with Sigstore Fulcio keyless OIDC (default: verify)"
  echo "  verify      Verify signature + attestations"
  echo "  attest-sbom Attach SBOM attestation (requires SBOM_DIR)"
  echo ""
  echo "Env flags:"
  echo "  COSIGN_VERSION    Override Cosign version (default: v2.4.1)"
  echo "  IMAGE_NAMESPACE   Required — e.g. your-org/your-repo"
  echo "  IMAGE_TAG         Tag to sign/verify (default: latest)"
  echo "  COSIGN_IDENTITY   Required for verify — workflow ref URL"
  echo "  SBOM_DIR          Required for attest-sbom — dir with .sbom.json files"
  exit 0
fi

sec::source_env IMAGE_REGISTRY IMAGE_NAMESPACE IMAGE_TAG
cd "$(sec::repo_root)"

COSIGN_VERSION="${COSIGN_VERSION:-v2.4.1}"
COSIGN_IMAGE="ghcr.io/sigstore/cosign/cosign:${COSIGN_VERSION}"

PREFIX="${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:?IMAGE_NAMESPACE required}"
TAG="${IMAGE_TAG:-latest}"
ACTION="${1:-verify}"
shift || true
if [[ $# -gt 0 ]]; then
  APPS=("$@")
else
  APPS=(api worker scheduler migration)
fi

cosign() { sec::docker_run --rm -e COSIGN_EXPERIMENTAL=1 "${COSIGN_IMAGE}" "$@"; }

case "${ACTION}" in
  sign)
    sec::log "Cosign ${COSIGN_VERSION} sign (keyless, Fulcio OIDC)"
    for app in "${APPS[@]}"; do
      cosign sign --yes "${PREFIX}/${app}:${TAG}"
    done
    sec::ok "Signed ${#APPS[@]} image(s) — public Rekor entry recorded."
    ;;
  attest-sbom)
    : "${SBOM_DIR:?SBOM_DIR required (path to .sbom.json files)}"
    for app in "${APPS[@]}"; do
      sbom="${SBOM_DIR}/${app}.sbom.json"
      [[ -f "$sbom" ]] || { sec::err "missing ${sbom}"; exit 1; }
      sec::log "Attesting SBOM for ${app}"
      sec::docker_run --rm -e COSIGN_EXPERIMENTAL=1 \
        -v "${SBOM_DIR}:/sbom:ro" \
        "${COSIGN_IMAGE}" attest --yes \
        --predicate "/sbom/${app}.sbom.json" \
        --type spdxjson \
        "${PREFIX}/${app}:${TAG}"
    done
    ;;
  verify)
    : "${COSIGN_IDENTITY:?COSIGN_IDENTITY required (e.g. https://github.com/<org>/<repo>/.github/workflows/release.yml@refs/tags/v1.2.3)}"
    : "${COSIGN_OIDC_ISSUER:=https://token.actions.githubusercontent.com}"
    sec::log "Cosign verify (identity=${COSIGN_IDENTITY})"
    for app in "${APPS[@]}"; do
      cosign verify \
        --certificate-identity "${COSIGN_IDENTITY}" \
        --certificate-oidc-issuer "${COSIGN_OIDC_ISSUER}" \
        "${PREFIX}/${app}:${TAG}" >/dev/null
      sec::ok "${app} verified"
    done
    ;;
  *)
    sec::err "Unknown action: ${ACTION} (use: sign | verify | attest-sbom)"
    exit 2
    ;;
esac
