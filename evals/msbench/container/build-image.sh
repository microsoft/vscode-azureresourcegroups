#!/usr/bin/env bash
# Build and push the Copilot-on-Rails benchmark image to our own ACR.
#
# ── Why this script exists ────────────────────────────────────────────────────
#
# The stock vscbench image has no `func`, so all five runtime-* gates stood down
# with `functionsHostUnavailable` on every run since they were written. Two
# routes to fix that were tried and measured before this one:
#
#   1. Install func in the phase preamble (config/phases/local.yaml).
#      Measured failure: `npm error code E401 - Unable to authenticate`. The
#      MSBench container's npm resolves through a registry the run holds no
#      token for. The fail-soft guard in local.yaml is still there and still
#      correct; it simply has nothing left to do once the image carries func.
#
#   2. Push to the shared MSBench ACR (codeexecservice.azurecr.io) via
#      benchmarks/build_and_push.py. That needs the `MSBench User` role AND a
#      local Docker daemon (`docker info`), neither of which we have.
#
# This is route 3: our own registry, built server-side with `az acr build`, so
# no local Docker daemon is required at all.
#
# ── What upstream owns and what we own ────────────────────────────────────────
#
# Dockerfile.vscbench and entry.sh belong to microsoft/vscode-copilot-evaluation
# and are FETCHED here rather than vendored, so this image cannot silently drift
# from the base every other benchmark uses. Everything under instances/ is ours.
#
# This mirrors `build_and_push.py --benchmarks-root <dir>`, which exists
# precisely so a benchmark can live outside the eval repo: it copies the
# scaffold files from its own checkout into your external root. We do the same
# fetch, then hand the assembled context to ACR Tasks instead of Docker.
#
# ── Prerequisites ─────────────────────────────────────────────────────────────
#
#   az login                     (any tenant that can see the registry)
#   gh auth status               (needs read access to the eval repo)
#
# Grant the CES service principal AcrPull on the registry ONCE before the first
# run - see README.md in this directory. Without it every instance returns
# `missing` with no output, because the CES job fails at its `Login to ACR`
# step, one step before it would have pulled anything.

set -euo pipefail

REGISTRY="${COR_ACR_NAME:-cormsbench}"
INSTANCE="${COR_INSTANCE_ID:-cor_functions_host}"
SUITE="${COR_SUITE:-vscbench}"
UPSTREAM_REPO="${COR_UPSTREAM_REPO:-microsoft/vscode-copilot-evaluation}"
UPSTREAM_REF="${COR_UPSTREAM_REF:-main}"

HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
INSTANCE_SRC="${HERE}/instances/${INSTANCE}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ -d "$INSTANCE_SRC" ] || die "No instance directory at ${INSTANCE_SRC}"

# The version is read from metadata.json rather than passed in, so the tag and
# the file that documents it cannot disagree. ACR is shared across teams and
# pushing overwrites any image with the same tag, so bumping image_version is
# the only safe way to change a published image.
VERSION="$(python -c 'import json,sys;print(json.load(open(sys.argv[1]))["image_version"])' "${INSTANCE_SRC}/metadata.json" 2>/dev/null || true)"
[ -n "$VERSION" ] || die "Could not read image_version from ${INSTANCE_SRC}/metadata.json"

# The tag format is not ours to choose: CES derives the benchmark name from the
# image_tag prefix, and msbench-cli matches instances on this exact shape.
TAG="${SUITE}.eval.x86_64.${INSTANCE}:msbench-${VERSION}"

command -v az >/dev/null 2>&1 || die "Azure CLI not found. Install it, then run: az login"
command -v gh >/dev/null 2>&1 || die "GitHub CLI not found; needed to fetch the upstream Dockerfile"

CTX="$(mktemp -d)"
trap 'rm -rf "$CTX"' EXIT

log "Fetching upstream build files from ${UPSTREAM_REPO}@${UPSTREAM_REF}"
for f in Dockerfile.vscbench entry.sh; do
    gh api "repos/${UPSTREAM_REPO}/contents/benchmarks/${f}?ref=${UPSTREAM_REF}" \
        --jq '.content' | tr -d '\n' | base64 -d > "${CTX}/${f}" \
        || die "Could not fetch benchmarks/${f} from ${UPSTREAM_REPO}"
    # Fetched content is LF already, but a CRLF here reaches the container as
    # `$'\r': command not found` at build time rather than failing locally.
    sed -i 's/\r$//' "${CTX}/${f}"
done

log "Assembling build context for ${INSTANCE}"
mkdir -p "${CTX}/internal" "${CTX}/.repos-staging/${INSTANCE}"
cp -R "${INSTANCE_SRC}" "${CTX}/internal/${INSTANCE}"
find "${CTX}/internal" -name '*.sh' -exec sed -i 's/\r$//' {} \;

# Dockerfile.vscbench COPYs several optional directories through globs, and
# Podman fails a glob that matches nothing. Upstream's answer is a sentinel file
# that every glob is guaranteed to match and that each COPY then deletes.
touch "${CTX}/.podman-placeholder" "${CTX}/.repos-staging/${INSTANCE}/.keep"

log "Building ${REGISTRY}.azurecr.io/${TAG} with ACR Tasks (no local Docker)"
# --platform is explicit because ACR Tasks will happily build for the agent
# pool's architecture, and a linux/arm64 image pulls fine yet fails to start on
# the CES runners with no useful error.
az acr build \
    --registry "$REGISTRY" \
    --image "$TAG" \
    --file Dockerfile.vscbench \
    --platform linux/amd64 \
    --build-arg "INSTANCE_ID=${INSTANCE}" \
    --build-arg "SUB_BENCHMARK_DIR=internal" \
    "$CTX"

log "Built ${REGISTRY}.azurecr.io/${TAG}"
log "Point a run at it with a dataset row whose container_registry is ${REGISTRY}.azurecr.io"
