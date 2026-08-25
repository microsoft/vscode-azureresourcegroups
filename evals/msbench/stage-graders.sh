#!/usr/bin/env bash
#
# Stage a self-contained grader bundle for MSBench `exec:` assertions.
#
# The Vally graders import two things that do not exist inside the MSBench
# container: the product's plan parser (reached by relative path out of evals/)
# and `jsonc-parser`. Rather than clone the repo in-container — which would let
# the graders drift from the build under test — we copy the exact files, keeping
# the same relative layout so every import resolves unchanged:
#
#   <assets>/graders/
#     evals/graders/*.ts                                the grader entry points
#     evals/src/artifacts/*.ts                          the validators
#     src/webviews/.../views/utils/                     the product parsers
#     node_modules/jsonc-parser/                        vendored, zero-dependency
#
# `jsonc-parser` is vendored rather than dropped because the extension itself
# ships it (root package.json) and uses it in TagFileSystem.ts — a file the
# grader accepts should be a file the product can read. Node resolves the bare
# specifier by walking up from evals/graders/ to <bundle>/node_modules.
#
# Usage: ./stage-graders.sh <assets-dir>
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"

ASSETS="${1:-}"
[ -n "$ASSETS" ] || { echo "usage: $0 <assets-dir>" >&2; exit 2; }

BUNDLE="${ASSETS}/graders"
# The whole parser directory, not just the files today's graders import — the
# parsers cross-reference each other, and enumerating them invites a bundle that
# breaks the next time a grader picks up a new one.
PARSER_DIR="src/webviews/copilotOnRails/views/utils"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/evals/graders" "$BUNDLE/evals/src/artifacts" \
         "$BUNDLE/${PARSER_DIR}" "$BUNDLE/node_modules"

cp "${REPO_ROOT}"/evals/graders/*.ts            "$BUNDLE/evals/graders/"
cp "${REPO_ROOT}"/evals/src/artifacts/*.ts      "$BUNDLE/evals/src/artifacts/"
cp -R "${REPO_ROOT}/${PARSER_DIR}/." "$BUNDLE/${PARSER_DIR}/"

[ -d "${REPO_ROOT}/node_modules/jsonc-parser" ] \
    || die "node_modules/jsonc-parser missing — run 'npm install' in the repo root first."
cp -R "${REPO_ROOT}/node_modules/jsonc-parser"  "$BUNDLE/node_modules/"

[ -f "$BUNDLE/node_modules/jsonc-parser/package.json" ] || die "jsonc-parser did not copy"

# The graders are ESM. Locally that is supplied by evals/package.json, which Node
# finds by walking up from the grader — but the bundle is extracted to
# /agent/assets in the container, where there is no ancestor package.json at all,
# so Node falls back to CommonJS and every grader dies on its first `import` with
# "Cannot use import statement outside a module".
#
# That failure exits 1, which is indistinguishable from a real product failure —
# so without this marker the suite reports the product as broken when the bundle
# is at fault. This is exactly what happened on run 2026082568864133.
cat > "$BUNDLE/package.json" <<'JSON'
{
  "name": "msbench-grader-bundle",
  "private": true,
  "type": "module"
}
JSON

# Verify the marker statically, because no local run can verify it behaviourally:
# Node 24 (a typical dev machine) treats a bare .ts file as ESM, while the
# container's Node 22.22 treats it as CommonJS. The bug this guards against is
# therefore INVISIBLE locally and only ever appears in-container — which is why
# it survived a passing smoke test and reached run 2026082568864133.
node -e '
const p = require(process.argv[1] + "/package.json");
if (p.type !== "module") process.exit(1);
' "$BUNDLE" || die "bundle package.json must set \"type\": \"module\""

# Smoke-test EVERY grader, not just one. Each is run against an empty directory,
# where the correct behaviour is to report missing artifacts and exit 1. An
# unresolved import also exits non-zero, so exit code alone proves nothing —
# what distinguishes them is that a grader which actually ran prints its own
# "FAIL:" line, and one that could not load prints a module-resolution error.
#
# Checking only a single grader previously let a missing product parser reach the
# bundle, so the loop is the point.
#
# CRITICAL: the bundle is copied OUT of the repo before being tested. Run in
# place, it inherits evals/package.json and node_modules/ from its ancestors and
# passes even when it is not self-contained — which is precisely how the missing
# "type": "module" above reached a live run. A temp dir has no such ancestors, so
# this reproduces the container.
PROBE="$(mktemp -d)"
ISOLATED="$(mktemp -d)"
trap 'rm -rf "$PROBE" "$ISOLATED"' EXIT
cp -R "$BUNDLE/." "$ISOLATED/"

BROKEN=""
for grader in "$ISOLATED"/evals/graders/validate-*.ts; do
    name="$(basename "$grader")"
    set +e
    output="$(EVALUATE_WORKSPACE="$PROBE" node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$grader" 2>&1)"
    status=$?
    set -e

    case "$output" in
        *ERR_MODULE_NOT_FOUND*|*"Cannot find module"*|*ERR_UNKNOWN_FILE_EXTENSION*)
            BROKEN="${BROKEN}\n  ${name}: unresolved import — $(printf '%s' "$output" | grep -oE "Cannot find module '[^']*'" | head -1)"
            continue ;;
        *"Cannot use import statement outside a module"*|*"Failed to load the ES module"*)
            BROKEN="${BROKEN}\n  ${name}: loaded as CommonJS — the bundle's package.json \"type\": \"module\" is missing or not being found"
            continue ;;
    esac
    if [ "$status" -eq 0 ]; then
        BROKEN="${BROKEN}\n  ${name}: passed against an EMPTY workspace — it cannot be failing for the right reasons"
    elif [ "$status" -ne 1 ]; then
        BROKEN="${BROKEN}\n  ${name}: exited ${status} (expected 1); grader fault, not a product failure"
    elif ! printf '%s' "$output" | grep -q "FAIL:"; then
        BROKEN="${BROKEN}\n  ${name}: exited 1 without printing a FAIL line — body may not have run"
    fi
done

[ -z "$BROKEN" ] || die "grader bundle is not self-contained:$(printf '%b' "$BROKEN")"

COUNT="$(find "$BUNDLE/evals/graders" -name 'validate-*.ts' | wc -l | tr -d ' ')"

log "Staged ${COUNT} graders at ${BUNDLE} ($(du -sh "$BUNDLE" | cut -f1)) — all self-contained"
