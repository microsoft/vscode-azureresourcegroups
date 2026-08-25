#!/usr/bin/env bash
#
# Assemble evals/msbench/assets/ for one suite.
#
# run.sh hardcodes ASSETS="${HERE}/assets" and stages assets/user-overrides.yaml
# as the last config layer. Rather than teach it about suites — which would
# conflict with PR #1689 — each suite keeps its config in its own directory and
# this script copies the selected one into place. `run.sh --skip-build` then
# works unchanged.
#
# Usage: ./stage.sh <suite>        # e.g. ./stage.sh local-dev
#        ./stage.sh --list
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS="${HERE}/assets"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# `assets/` is excluded: it holds the *staged* copy of a suite's config, so
# listing it would offer the last-staged suite back under a bogus name.
suites() { find "$HERE" -mindepth 2 -maxdepth 2 -name user-overrides.yaml \
             -not -path "${HERE}/assets/*" \
             -exec dirname {} \; | xargs -n1 basename | sort; }

SUITE="${1:-}"
if [ "$SUITE" = "--list" ]; then suites; exit 0; fi
[ -n "$SUITE" ] || die "usage: $0 <suite>   (available: $(suites | tr '\n' ' '))"

CONFIG="${HERE}/${SUITE}/user-overrides.yaml"
[ -f "$CONFIG" ] || die "no suite '${SUITE}' (available: $(suites | tr '\n' ' '))"

mkdir -p "$ASSETS"
cp "$CONFIG" "${ASSETS}/user-overrides.yaml"
log "Staged ${SUITE}/user-overrides.yaml"

# Only stage what the suite actually references. Checking the config keeps a
# suite that needs neither from paying for a bundle it will not use.
if grep -q '/agent/assets/graders' "$CONFIG"; then
    "${HERE}/stage-graders.sh" "$ASSETS"
fi
if grep -q '/agent/assets/workspace-seed' "$CONFIG"; then
    "${HERE}/stage-workspace.sh" "$ASSETS"
else
    # Clear a seed left by a previously staged suite. Leaving it would ship an
    # unreferenced 80K into the container, and — worse — let preflight validate
    # this suite against the *other* suite's baseline.
    rm -rf "${ASSETS}/workspace-seed"
fi

log "Assets ready at ${ASSETS} — now run: ./run.sh --skip-build"
