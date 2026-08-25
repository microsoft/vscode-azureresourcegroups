#!/usr/bin/env bash
#
# Stage the local-dev workspace seed for MSBench.
#
# The debug agents analyse an existing project, so the workspace must already
# contain one. We reuse `evals/grader-certification/reference-node-fullstack`
# — a real scaffolded Node full-stack project that is already maintained as the
# grader certification fixture, so it cannot rot independently of the graders.
#
# Its `.azure/vscode-debug-plan.md` and `.vscode/` are deliberately EXCLUDED:
# those are the artifacts under test, and seeding them would let every assertion
# pass without the agent doing anything.
#
# Usage: ./stage-workspace.sh <assets-dir>
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
FIXTURE="${REPO_ROOT}/evals/grader-certification/reference-node-fullstack"

ASSETS="${1:-}"
[ -n "$ASSETS" ] || { echo "usage: $0 <assets-dir>" >&2; exit 2; }
SEED="${ASSETS}/workspace-seed"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ -d "$FIXTURE" ] || die "fixture not found at ${FIXTURE}"

rm -rf "$SEED"
mkdir -p "$SEED"
cp -R "${FIXTURE}/." "$SEED/"

# Remove the artifacts under test. A seeded plan or launch.json would make the
# assertions pass vacuously — the single most dangerous failure mode here.
rm -rf "${SEED}/.vscode" "${SEED}/.azure/vscode-debug-plan.md" \
       "${SEED}/api-test-collections" "${SEED}/docker-compose.yml"

for forbidden in .vscode/launch.json .vscode/tasks.json .azure/vscode-debug-plan.md; do
    if [ -e "${SEED}/${forbidden}" ]; then
        die "seed still contains ${forbidden}; assertions would pass vacuously"
    fi
done

# The project plan must survive: azure-debug-plan reads it to classify services.
[ -f "${SEED}/.azure/project-plan.md" ] || die "seed lost .azure/project-plan.md"

log "Staged workspace seed at ${SEED} ($(du -sh "$SEED" | cut -f1))"
