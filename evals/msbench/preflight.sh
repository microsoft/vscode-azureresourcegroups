#!/usr/bin/env bash
#
# Verify a suite offline, before spending an MSBench run on it.
#
# An MSBench run is ~15 minutes and costs model calls, so the failures worth
# catching here are the dumb ones: an `exec:` pointing at a path that is not in
# the bundle, a SQL typo, or — the dangerous one — an assertion that would have
# passed no matter what the agent did.
#
# What this CAN check, without a container:
#   * the config parses, and every referenced /agent/assets path was staged
#   * every `query:` is valid SQLite against the real assertion schema
#   * every `exec:` FAILS against the bare workspace seed  (no vacuous passes)
#   * every `exec:` PASSES against the completed reference fixture (not just broken)
#
# What it CANNOT check: the agent's behaviour, the extension host, tool call
# names as VS Code reports them, or whether the hand-off is observed. Those need
# a real run.
#
# Usage: ./preflight.sh <suite>
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
ASSETS="${HERE}/assets"
FIXTURE="${REPO_ROOT}/evals/grader-certification/reference-node-fullstack"

SUITE="${1:-}"
[ -n "$SUITE" ] || { echo "usage: $0 <suite>" >&2; exit 2; }
CONFIG="${HERE}/${SUITE}/user-overrides.yaml"
[ -f "$CONFIG" ] || { echo "no suite '${SUITE}'" >&2; exit 2; }

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
pass() { printf '  \033[1;32mPASS\033[0m %s\n' "$*"; }
fail() { printf '  \033[1;31mFAIL\033[0m %s\n' "$*"; FAILED=$((FAILED+1)); }
FAILED=0

bold "Staging ${SUITE}"
"${HERE}/stage.sh" "$SUITE" >/dev/null
pass "assets staged"

# Pull the assertions out of the YAML once; everything below reads this.
PLAN="$(mktemp)"; trap 'rm -f "$PLAN"' EXIT
node -e '
const yaml = require(process.argv[1] + "/evals/node_modules/yaml");
const fs = require("fs");
const doc = yaml.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = [];
(doc.promptSteps || []).forEach((step, i) => {
    (step.assertions || []).forEach((a) => {
        if (a.exec)  out.push(JSON.stringify({ kind: "exec",  step: i, comment: a.comment, value: a.exec }));
        if (a.query) out.push(JSON.stringify({ kind: "query", step: i, comment: a.comment, value: a.query }));
    });
});
fs.writeFileSync(process.argv[3], out.join("\n") + "\n");
' "$REPO_ROOT" "$CONFIG" "$PLAN"

read_field() { node -e 'process.stdout.write(String(JSON.parse(process.argv[1])[process.argv[2]] ?? ""))' "$1" "$2"; }

bold "Referenced container paths exist in assets/"
while IFS= read -r row; do
    [ -n "$row" ] || continue
    value="$(read_field "$row" value)"
    for path in $(printf '%s' "$value" | grep -oE '/agent/assets/[^ ]+' || true); do
        local_path="${ASSETS}/${path#/agent/assets/}"
        if [ -e "$local_path" ]; then pass "${path}"; else fail "${path} — not staged (would be a missing file in-container)"; fi
    done
done < "$PLAN"

# Also check paths referenced from the `script:` block, which runs before the agent.
for path in $(grep -oE '/agent/assets/[a-zA-Z0-9_./-]+' "$CONFIG" | sort -u); do
    case "$path" in
        */extensions/*) continue ;;   # the VSIX is built by run.sh, not stage.sh
    esac
    local_path="${ASSETS}/${path#/agent/assets/}"
    [ -e "$local_path" ] || fail "${path} — referenced but not staged"
done

bold "SQL assertions are valid SQLite"
# The real schema, per the assertion tables MSBench exposes.
SCHEMA="CREATE TABLE files(path TEXT, content TEXT, stepIndex INT);
CREATE TABLE toolCalls(tool TEXT, stepIndex INT);
CREATE TABLE llm_responses(response TEXT, stepIndex INT);"
while IFS= read -r row; do
    [ -n "$row" ] || continue
    [ "$(read_field "$row" kind)" = "query" ] || continue
    q="$(read_field "$row" value)"
    c="$(read_field "$row" comment)"
    if err=$(printf '%s\nSELECT 1 FROM (%s) LIMIT 0;\n' "$SCHEMA" "$q" | sqlite3 :memory: 2>&1 >/dev/null); then
        pass "${c}"
    else
        fail "${c} — ${err}"
    fi
done < "$PLAN"

# The check that matters most. An assertion which passes against a workspace the
# agent has not touched is worse than no assertion, because it reports green.
# The check that matters most. An assertion which passes against a workspace the
# agent has not touched is worse than no assertion, because it reports green.
#
# The baseline is the workspace as the agent first sees it: the seed for a suite
# that has one, otherwise an empty directory — which is exactly what a suite like
# project-plan starts from.
PROBE="$(mktemp -d)"
if [ -d "${ASSETS}/workspace-seed" ]; then
    cp -R "${ASSETS}/workspace-seed/." "$PROBE/"
    bold "exec assertions FAIL against the bare seed (no vacuous passes)"
else
    bold "exec assertions FAIL against an empty workspace (no vacuous passes)"
fi
while IFS= read -r row; do
    [ -n "$row" ] || continue
    [ "$(read_field "$row" kind)" = "exec" ] || continue
    cmd="$(read_field "$row" value)"; c="$(read_field "$row" comment)"
    # Rewrite container paths to their local equivalents.
    local_cmd="${cmd//\/agent\/assets/${ASSETS}}"
    local_cmd="${local_cmd//EVALUATE_WORKSPACE=\/workspace/EVALUATE_WORKSPACE=$PROBE}"
    set +e; out="$(eval "$local_cmd" 2>&1)"; st=$?; set -e
    if [ "$st" -eq 1 ]; then pass "${c}"
    elif [ "$st" -eq 0 ]; then fail "${c} — PASSED on an untouched workspace; this assertion proves nothing"
    else fail "${c} — exit ${st} (grader fault, not a product failure): $(printf '%s' "$out" | head -2 | tr '\n' ' ')"; fi
done < "$PLAN"
rm -rf "$PROBE"

bold "exec assertions PASS against a workspace in the expected state for their step"
# The reference workspace is step-dependent. A gate assertion is *phase-scoped*
# — it asserts the plan is still at "Planning" and generation has not started —
# so validating it against the completed fixture would wrongly report it broken.
# Step 0 therefore gets a synthesized planning-state workspace; later steps get
# the completed fixture.
PLANNING="$(mktemp -d)"; cp -R "${FIXTURE}/." "$PLANNING/"
rm -rf "${PLANNING}/.vscode" "${PLANNING}/api-test-collections"
sed -i '' 's/^> \*\*Status:\*\* .*/> **Status:** Planning/' "${PLANNING}/.azure/vscode-debug-plan.md"
grep -q '^> \*\*Status:\*\* Planning' "${PLANNING}/.azure/vscode-debug-plan.md" \
    || { echo "could not synthesize a planning-state fixture" >&2; exit 3; }

while IFS= read -r row; do
    [ -n "$row" ] || continue
    [ "$(read_field "$row" kind)" = "exec" ] || continue
    cmd="$(read_field "$row" value)"; c="$(read_field "$row" comment)"
    if [ "$(read_field "$row" step)" = "0" ]; then ref="$PLANNING"; label="planning-state"; else ref="$FIXTURE"; label="completed"; fi
    local_cmd="${cmd//\/agent\/assets/${ASSETS}}"
    local_cmd="${local_cmd//EVALUATE_WORKSPACE=\/workspace/EVALUATE_WORKSPACE=$ref}"
    set +e; out="$(eval "$local_cmd" 2>&1)"; st=$?; set -e
    if [ "$st" -eq 0 ]; then pass "${c} [${label}]"
    else fail "${c} — exit ${st} against a KNOWN-GOOD ${label} workspace, so it would fail a correct agent: $(printf '%s' "$out" | grep -E 'FAIL|•' | head -3 | tr '\n' ' ')"; fi
done < "$PLAN"
rm -rf "$PLANNING"

echo
if [ "$FAILED" -eq 0 ]; then
    bold "Preflight clean — safe to submit ${SUITE} to MSBench."
else
    printf '\033[1;31m%s preflight check(s) failed.\033[0m Fix before spending an MSBench run.\n' "$FAILED"
    exit 1
fi
