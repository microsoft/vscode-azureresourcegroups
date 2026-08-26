#!/usr/bin/env bash
#
# Run the project-plan eval on MSBench.
#
# Builds the extension VSIX, stages it next to user-overrides.yaml, and submits
# a run. Everything the run needs is derived here, so a clean machine with
# `az login` already done should be able to execute this unmodified.
#
# Usage:
#   ./run.sh                 # submit and stream progress
#   ./run.sh --skip-build    # reuse the VSIX already staged
#   ./run.sh --build-only    # build and stage the VSIX, then stop
#   ./run.sh --stimulus api-only-inventory
#                            # run a different stimulus (default:
#                            # photo-app-requirements). See config/stimuli/.
#   ./run.sh --stack node-express-postgres --phase plan
#                            # run a stack instead: the prompt and the gate
#                            # wiring are derived from config/stacks/<id>.yaml
#                            # rather than hand-written. See config/gates.yaml.
#
set -euo pipefail

SKIP_BUILD=0
BUILD_ONLY=0
STIMULUS="photo-app-requirements"
STACK=""
PHASE=""
PASSTHRU=()
while [ $# -gt 0 ]; do
    case "$1" in
        --skip-build) SKIP_BUILD=1 ;;
        --build-only) BUILD_ONLY=1 ;;
        --stimulus) shift; [ $# -gt 0 ] || { echo "--stimulus needs a value" >&2; exit 1; }; STIMULUS="$1" ;;
        --stimulus=*) STIMULUS="${1#*=}" ;;
        --stack) shift; [ $# -gt 0 ] || { echo "--stack needs a value" >&2; exit 1; }; STACK="$1" ;;
        --stack=*) STACK="${1#*=}" ;;
        --phase) shift; [ $# -gt 0 ] || { echo "--phase needs a value" >&2; exit 1; }; PHASE="$1" ;;
        --phase=*) PHASE="${1#*=}" ;;
        *) PASSTHRU+=("$1") ;;
    esac
    shift
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
ASSETS="${HERE}/assets"
VSIX_DEST="${ASSETS}/extensions/vscode-azureresourcegroups.vsix"

# Borrowed purely for its container image; user-overrides.yaml replaces its
# prompt and assertions wholesale. Swapping this for a heavier instance is how
# we would get a richer starting workspace later.
BENCHMARK="${BENCHMARK:-vscbench.say_hello}"

# CES serialises runs that share the same (model, endpoint tag) pair, so two of
# our runs queue instead of racing. Both halves of that key have to match
# character-for-character or the runs land in different queues and queueing
# silently does nothing — see README.md, "Run queueing".
#
# Only the endpoint half is set here. The model half is derived: `--model .`
# makes the vscode plugin read `modelSelector` out of the staged
# user-overrides.yaml, so `config/base.yaml` already fixes it.
#
# Deliberately a literal rather than `${QUEUE_ENDPOINT_TAG:-...}`: an env
# override is exactly the drift this value cannot tolerate.
QUEUE_ENDPOINT_TAG="copilot-on-rails"

# Smoke is a CES preflight that takes the *first requested instance* of a
# multi-instance run and executes it for real — real image, real model tokens,
# real slot — before fanning out. Today it is opt-in and off by default, so this
# flag changes nothing; it is set because the MSBench wiki states the default
# will flip to on for eligible runs, and `--smoke_mode none` is the documented
# opt-out that survives that flip.
#
# It is worth pinning now rather than later: smoke only applies to runs with
# more than one instance, so it is inert while we submit one stimulus per run
# and would start silently duplicating a full scenario the moment we don't.
#
# The trade is a lost early setup-validity check. Acceptable here — that check
# earns its keep when a bad agent package would fail every instance identically,
# and run.sh already validates the VSIX contents and rebuilds the config locally
# before submitting. Placed before "${PASSTHRU[@]}" so `--smoke_mode auto` can
# still be passed deliberately.
SMOKE_MODE="none"

# Resource id of the Azure DevOps first-party app, used to mint a feed token.
ADO_RESOURCE="499b84ac-1321-427f-aa17-267ca6975798"
VENV="${MSBENCH_VENV:-${HOME}/.msbench-venv}"

# The feed proxies large transitive deps (pandas, pyarrow) from upstream PyPI and
# is routinely slower than pip's 15s default. A timed-out download is not treated
# as a network error but as an unusable candidate, so pip silently backtracks to
# ever-older msbench-cli releases and "succeeds" with the wrong version.
PIP_NET_FLAGS=(--timeout 180 --retries 10)

# Floors, not pins: upgrades are still picked up, but pip fails loudly instead of
# quietly resolving an ancient release. Without them a timed-out or 401'd
# download of a transitive dep (pandas, pyarrow) makes pip backtrack rather than
# error, and it will happily "succeed" on msbench-cli 0.3.17 — which submits, but
# against a different agent contract than the one these configs were written for.
MSBENCH_CLI_SPEC="msbench-cli>=0.3.54"
MSBENCH_VSCODE_SPEC="msbench-agent-vscode>=0.0.22"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# --- build + stage the extension ---------------------------------------------
#
# Deliberately before the Azure preflight: a build break is the most likely
# failure, and diagnosing it should not require credentials, nor should a token
# sit around for the several minutes a cold build takes.

if [ "$SKIP_BUILD" -eq 0 ]; then
    log "Building VSIX"
    ( cd "$REPO_ROOT" && [ -d node_modules ] || npm install )
    # `npm run package` is only `vsce package`; there is no vscode:prepublish
    # hook, so without this the VSIX ships without dist/extension.bundle and the
    # extension host fails to activate inside the container.
    ( cd "$REPO_ROOT" && npm run build )
    ( cd "$REPO_ROOT" && npm run package >/dev/null )
fi

BUILT_VSIX="$(ls -t "${REPO_ROOT}"/vscode-azureresourcegroups-*.vsix 2>/dev/null | head -1 || true)"
if [ -n "$BUILT_VSIX" ]; then
    mkdir -p "$(dirname "$VSIX_DEST")"
    cp "$BUILT_VSIX" "$VSIX_DEST"
fi
[ -f "$VSIX_DEST" ] || die "No VSIX at ${VSIX_DEST}. Run without --skip-build."

# The container unpacks resources/agents out of this VSIX, so a build missing
# them would fail confusingly at assertion time instead of here.
# Note: no `| grep -q` here — grep exits early, unzip takes SIGPIPE, and
# `set -o pipefail` would report that as a missing-agents failure.
VSIX_LISTING="$(unzip -l "$VSIX_DEST")"
case "$VSIX_LISTING" in
    *resources/agents/azure-project-plan.agent.md*) ;;
    *) die "VSIX has no resources/agents/ — check .vscodeignore" ;;
esac
# main.js is a shim that requires ./dist/extension.bundle. If the build was
# skipped the package still looks valid but the extension host cannot activate,
# which surfaces remotely as every assertion failing for no obvious reason.
case "$VSIX_LISTING" in
    *extension/dist/extension.bundle.js*) ;;
    *) die "VSIX has no dist/extension.bundle.js — run 'npm run build' first" ;;
esac

log "Staged $(basename "$BUILT_VSIX" 2>/dev/null || basename "$VSIX_DEST") ($(du -h "$VSIX_DEST" | cut -f1))"

# --- stage the graders and build the config ----------------------------------
#
# The `exec:` assertions run the real Vally validators inside the container, so
# their sources have to travel with the run. Staged on every invocation —
# including --skip-build — because they are source files read straight off the
# working tree: staging a stale copy would grade the wrong contract.
log "Staging graders"
node "${HERE}/stage-graders.ts"

# The scaffold and local-dev phases grade agents whose first action is to read
# `.azure/project-plan.md`, so the workspace has to be seeded before turn 0. The
# stimulus says *what state it needs* with a `# seed:` directive; this resolves
# that to a recipe and writes assets/workspace/, which the phase `script:` copies
# into /workspace. Run for every stimulus, including unseeded ones, because it
# also *clears* assets/workspace/ — otherwise a previous run's plan would leak
# into a stimulus whose whole premise is that no plan exists.
log "Staging workspace seed"
node "${HERE}/stage-workspace.ts" "$STIMULUS"

# `assets/user-overrides.yaml` is generated because run-agent.sh will only ever
# read that one filename, so selecting a stimulus means writing that file.
#
# Two sources, never both. A hand-written stimulus is read verbatim; a stack has
# its prompt and its gate wiring derived from data. Passing both would silently
# grade one while the operator believed they had asked for the other, so it is
# refused here rather than resolved by precedence.
if [ -n "$STACK" ]; then
    # Only the stack path needs the eval toolchain: resolving a stack parses YAML,
    # and the graders' own promise — that run.sh works on a clean machine — is
    # kept by leaving the stimulus path free of it. Installed here rather than at
    # the top so a stimulus run on a bare host still costs nothing.
    ( cd "${HERE}/.." && [ -d node_modules ] || npm install )
    log "Building config for stack '${STACK}' (phase '${PHASE:-plan}')"
    node "${HERE}/build-config.ts" --stack "$STACK" ${PHASE:+--phase "$PHASE"}
else
    [ -z "$PHASE" ] || die "--phase applies only with --stack; a stimulus selects its phase with its own '# phase:' directive"
    log "Building config for stimulus '${STIMULUS}'"
    node "${HERE}/build-config.ts" "$STIMULUS"
fi

if [ "$BUILD_ONLY" -eq 1 ]; then
    log "Build only; not submitting."
    exit 0
fi

# --- preflight ---------------------------------------------------------------

command -v az >/dev/null || die "Azure CLI not found. Install it, then run: az login"
az account show >/dev/null 2>&1 || die "Not logged in to Azure. Run: az login"

# msbench-cli needs 3.10+; macOS still ships 3.9 as python3.
PYTHON=""
for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && \
       "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then
        PYTHON="$candidate"; break
    fi
done
[ -n "$PYTHON" ] || die "Need Python 3.10+ for msbench-cli. Try: brew install python@3.12"

# --- msbench-cli -------------------------------------------------------------

if [ ! -x "${VENV}/bin/msbench-cli" ]; then
    log "Installing msbench-cli into ${VENV} (using $($PYTHON --version))"
    "$PYTHON" -m venv "$VENV"
    "${VENV}/bin/python" -m pip install --quiet --upgrade pip

    # Token goes in the index URL rather than via keyring, which otherwise drops
    # into an interactive prompt and hangs a non-tty shell.
    log "Acquiring Azure DevOps feed token"
    ADO_TOKEN="$(az account get-access-token --resource "$ADO_RESOURCE" --query accessToken -o tsv)" \
        || die "Could not get a DevOps token. Request the 'MSBench User' role at https://aka.ms/msbench/access"

    PIP_INDEX_URL="https://msbench:${ADO_TOKEN}@pkgs.dev.azure.com/devdiv/_packaging/MicrosoftSweBench/pypi/simple/" \
        "${VENV}/bin/python" -m pip install --quiet "${PIP_NET_FLAGS[@]}" "$MSBENCH_CLI_SPEC" "$MSBENCH_VSCODE_SPEC" \
        || die "msbench-cli install failed. Confirm feed access at https://aka.ms/msbench/access"
    unset ADO_TOKEN
fi
log "msbench-cli $("${VENV}/bin/msbench-cli" version 2>/dev/null | tail -1)"

# Special agents are discovered as console scripts on PATH, not as imports, so
# calling ${VENV}/bin/msbench-cli directly reports every plugin as "not
# installed". This is the equivalent of activating the venv.
export PATH="${VENV}/bin:${PATH}"

# msbench-cli depends on this, but a plugin missing from PATH and one missing
# from site-packages produce the same error, so verify the real thing.
if ! "${VENV}/bin/python" -m pip show msbench-agent-vscode >/dev/null 2>&1; then
    log "Installing the vscode special agent plugin"
    ADO_TOKEN="$(az account get-access-token --resource "$ADO_RESOURCE" --query accessToken -o tsv)"
    PIP_INDEX_URL="https://msbench:${ADO_TOKEN}@pkgs.dev.azure.com/devdiv/_packaging/MicrosoftSweBench/pypi/simple/" \
        "${VENV}/bin/python" -m pip install --quiet "${PIP_NET_FLAGS[@]}" "$MSBENCH_VSCODE_SPEC" \
        || die "Could not install msbench-agent-vscode"
    unset ADO_TOKEN
fi

# --- submit ------------------------------------------------------------------

# assets/ is shared mutable state: every invocation rewrites user-overrides.yaml
# before uploading it. Two overlapping runs therefore race, and the loser
# silently submits the winner's stimulus -- a run that looks entirely normal but
# grades the wrong prompt. Serialise instead.
LOCK="${ASSETS}/.run.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
    die "Another run.sh is using ${ASSETS} (lock: ${LOCK}).
    Concurrent runs would submit each other's stimulus. Wait for it to finish,
    or remove the lock if no run.sh is alive."
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

log "Submitting to MSBench (benchmark: ${BENCHMARK}, stimulus: ${STIMULUS})"
# Echo the prompt actually being submitted, so a stimulus/config mismatch is
# visible in the log rather than only discoverable by unzipping the results.
sed -n '/^promptSteps:/,/assertions:/p' "${ASSETS}/user-overrides.yaml" \
    | sed -n '2,4p' | sed 's/^/    | /'
echo

RUN_LOG="$(mktemp -t msbench-run)"
trap 'rm -f "$RUN_LOG"; rmdir "$LOCK" 2>/dev/null || true' EXIT

set +e
"${VENV}/bin/msbench-cli" run \
    --agent vscode \
    --model . \
    --benchmark "$BENCHMARK" \
    --agent-assets "$ASSETS" \
    --smoke_mode "$SMOKE_MODE" \
    ${PASSTHRU[@]+"${PASSTHRU[@]}"} \
    --tag "endpoint=${QUEUE_ENDPOINT_TAG}" 2>&1 | tee "$RUN_LOG"
CLI_STATUS=${PIPESTATUS[0]}
set -e

# A finished run is not automatically a *result*. Two conditions make the
# results table mean something other than what it appears to mean, and neither
# is visible in the table itself: the agent was throttled mid-run (so it
# produced nothing, and every assertion resolves trivially), or the model that
# answered was not the model requested. verify-run.ts checks both and owns the
# verdict; exit 75 means "not a result, retry later" and 65 means "measured the
# wrong thing", both distinct from the 1 that means a genuine red run.
RUN_ID="$(grep -oE 'run_id=[0-9]+' "$RUN_LOG" | head -1 | cut -d= -f2 || true)"
if [ -n "$RUN_ID" ]; then
    RESULTS_ZIP="$(ls "${HOME}/Library/Application Support/msbench/runs/${RUN_ID}/results.zip" \
                      "${HOME}/.local/share/msbench/runs/${RUN_ID}/results.zip" 2>/dev/null | head -1 || true)"
    if [ -n "$RESULTS_ZIP" ]; then
        SCRATCH="$(mktemp -d)"
        unzip -oq "$RESULTS_ZIP" -d "$SCRATCH" 2>/dev/null || true
        find "$SCRATCH" -name '*-output.zip' -exec unzip -oq {} -d "${SCRATCH}/out" \; 2>/dev/null || true

        set +e
        node "${HERE}/verify-run.ts" --run-dir "${SCRATCH}/out" --run-id "$RUN_ID"
        VERIFY_STATUS=$?
        set -e

        rm -rf "$SCRATCH"
        if [ "$VERIFY_STATUS" -ne 0 ]; then
            exit "$VERIFY_STATUS"
        fi
    fi
fi

exit "$CLI_STATUS"
