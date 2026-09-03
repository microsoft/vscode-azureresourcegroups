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
#   ./run.sh --model claude-opus-4.7
#                            # retarget the run without editing config/base.yaml.
#                            # The suite requires every supported model, and this
#                            # is the only way to sweep one without mutating the
#                            # shared default. NOTE: the model is half the CES
#                            # queueing key, so overridden runs queue separately
#                            # from default-model ones.
#   BENCHMARK=corbench.cor_functions_host \
#     ./run.sh --dataset evals/msbench/container/dataset.jsonl
#                            # run inside our own container image, which carries
#                            # the Azure Functions Core Tools. Paths resolve from
#                            # the repo root. See container/README.md.
#
set -euo pipefail

SKIP_BUILD=0
BUILD_ONLY=0
STIMULUS="${STIMULUS:-photo-app-requirements}"
STACK=""
PHASE=""
MODEL=""
PASSTHRU=()
# The benchmark dataset naming the container image to run in. Empty means "use
# whatever MSBench's published data says for $BENCHMARK", which is the stock
# image. Env-overridable for the same reason BENCHMARK and STIMULUS are: the CI
# workflow can only reach this script through the environment.
#
# Handled explicitly rather than left to the passthrough catch-all so the path
# can be resolved and CHECKED. A dataset that does not exist is the worst input
# this script takes: msbench-cli falls back to the default registry, the run is
# submitted against an image that is not there, and the instance comes back
# `missing` with no output — indistinguishable from an infrastructure outage.
DATASET="${DATASET:-}"
# Set by --ignore-cooldown. See the budget preflight below.
IGNORE_COOLDOWN=0
# Observed, not chosen: msbench-cli writes results to `<data_dir>/<run_id>/`, and
# `--data_dir` is a passthrough flag we do not otherwise interpret. The results
# lookup after the run has to know where they landed, so the value is recorded
# here while still being forwarded to the CLI unchanged.
DATA_DIR=""
while [ $# -gt 0 ]; do
    case "$1" in
        --skip-build) SKIP_BUILD=1 ;;
        --build-only) BUILD_ONLY=1 ;;
        --stimulus) shift; [ $# -gt 0 ] || { echo "--stimulus needs a value" >&2; exit 1; }; STIMULUS="$1" ;;
        --stimulus=*) STIMULUS="${1#*=}" ;;
        # Intercepted, NOT passed through. `msbench-cli run` is already invoked
        # with `--model .`, which is what makes the vscode plugin read the model
        # out of the staged user-overrides.yaml; forwarding a second --model
        # would fight that. This one goes to build-config.ts instead.
        --model) shift; [ $# -gt 0 ] || { echo "--model needs a value" >&2; exit 1; }; MODEL="$1" ;;
        --model=*) MODEL="${1#*=}" ;;
        --stack) shift; [ $# -gt 0 ] || { echo "--stack needs a value" >&2; exit 1; }; STACK="$1" ;;
        --stack=*) STACK="${1#*=}" ;;
        --phase) shift; [ $# -gt 0 ] || { echo "--phase needs a value" >&2; exit 1; }; PHASE="$1" ;;
        --phase=*) PHASE="${1#*=}" ;;
        --dataset) shift; [ $# -gt 0 ] || { echo "--dataset needs a value" >&2; exit 1; }; DATASET="$1" ;;
        --dataset=*) DATASET="${1#*=}" ;;
        --ignore-cooldown) IGNORE_COOLDOWN=1 ;;
        # Recorded AND forwarded. Both spellings, both forms — the CLI accepts
        # `--data_dir` and `--data-dir`, so matching only one would reintroduce
        # the silent skip this exists to prevent.
        --data_dir|--data-dir)
            PASSTHRU+=("$1"); shift
            [ $# -gt 0 ] || { echo "--data_dir needs a value" >&2; exit 1; }
            DATA_DIR="$1"; PASSTHRU+=("$1") ;;
        --data_dir=*|--data-dir=*) DATA_DIR="${1#*=}"; PASSTHRU+=("$1") ;;
        *) PASSTHRU+=("$1") ;;
    esac
    shift
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
ASSETS="${HERE}/assets"
VSIX_DEST="${ASSETS}/extensions/vscode-azureresourcegroups.vsix"
# The test-only debug probe extension, built from source alongside the product.
PROBE_SRC="${REPO_ROOT}/evals/debug-probe/extension"
PROBE_DEST="${ASSETS}/extensions/cor-debug-probe.vsix"
# The known-debuggable project the breakpoint stimulus runs against. Same fixture
# evals/debug-probe certifies with, so green here and green locally mean the same.
FIXTURE_SRC="${REPO_ROOT}/evals/grader-certification/reference-node-fullstack"
FIXTURE_DEST="${ASSETS}/fixtures/reference-node-fullstack"
# The realistic Functions project, for the stimulus that asks whether the gate can
# answer for the stack the agent actually generates rather than for a fixture built
# to be answerable. See config/stimuli/functions-breakpoint-control.yaml.
LOCALDEV_SRC="${REPO_ROOT}/evals/grader-certification/stage-local-dev"
LOCALDEV_DEST="${ASSETS}/fixtures/stage-local-dev"

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

# --- resolve the dataset ------------------------------------------------------
#
# Relative paths resolve against the repo root, not the caller's cwd, so the same
# value works from a shell, from CI, and from an editor task. The existence check
# is the point of doing this here rather than passing the flag straight through:
# see the note at the top of the file for why a missing dataset is worse than a
# missing flag.
if [ -n "$DATASET" ]; then
    case "$DATASET" in
        /*|[A-Za-z]:[\\/]*) ;;
        *) DATASET="${REPO_ROOT}/${DATASET}" ;;
    esac
    [ -f "$DATASET" ] || die "No dataset at ${DATASET}.
    A dataset names the container image to run in. If it is missing, msbench-cli
    falls back to the default registry and the instance returns \`missing\` with no
    output, which reads as an infrastructure failure rather than a typo."
    PASSTHRU+=(--dataset "$DATASET")
    log "Dataset: ${DATASET}"
fi

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

# --- build + stage the debug probe -------------------------------------------
#
# A second, test-only extension (evals/debug-probe) that rides alongside the
# product VSIX. It is inert unless a stimulus writes `debug-probe.json` into the
# workspace, so it is built and installed on every run rather than conditionally.
#
# This is the one thing under evals/ that needs compiling: the graders run
# straight off .ts via Node's type stripping, but the VS Code extension host
# cannot strip types, so the probe must ship as emitted JavaScript.

if [ "$SKIP_BUILD" -eq 0 ]; then
    log "Building debug probe VSIX"
    ( cd "$PROBE_SRC" && [ -d node_modules ] || npm install )
    ( cd "$PROBE_SRC" && npm run package >/dev/null )
fi

BUILT_PROBE="${PROBE_SRC}/cor-debug-probe.vsix"
if [ -f "$BUILT_PROBE" ]; then
    mkdir -p "$(dirname "$PROBE_DEST")"
    cp "$BUILT_PROBE" "$PROBE_DEST"
fi
[ -f "$PROBE_DEST" ] || die "No debug probe VSIX at ${PROBE_DEST}. Run without --skip-build."

# The probe's package.json points main at out/extension.js. If `npm run package`
# ran without compiling, the VSIX packages cleanly and then fails to activate in
# the container — which looks exactly like the extension not being installed at
# all, the very thing this gate exists to distinguish.
PROBE_LISTING="$(unzip -l "$PROBE_DEST")"
case "$PROBE_LISTING" in
    *extension/out/extension.js*) ;;
    *) die "Debug probe VSIX has no out/extension.js — run 'npm run compile' in evals/debug-probe/extension" ;;
esac

log "Staged $(basename "$PROBE_DEST") ($(du -h "$PROBE_DEST" | cut -f1))"

# --- stage the debug fixture -------------------------------------------------
#
# The breakpoint stimulus needs a project that is known to be debuggable, so the
# run answers "can a debugger work in this container" rather than "did the agent
# write a good project this time". Those are different questions and only one of
# them is about the harness.
#
# Copied rather than generated: this is the same fixture `evals/debug-probe`
# certifies against locally, so a green run here and a green certification mean
# the same thing.
log "Staging debug fixture"
rm -rf "$FIXTURE_DEST"
mkdir -p "$(dirname "$FIXTURE_DEST")"
cp -R "$FIXTURE_SRC" "$FIXTURE_DEST"
# A stale .eval from a local certification run would seed the container with a
# verdict nobody produced there, which is the most misleading artifact possible.
rm -rf "${FIXTURE_DEST}/.eval" "${FIXTURE_DEST}/node_modules" "${FIXTURE_DEST}/debug-probe.json"
[ -f "${FIXTURE_DEST}/.vscode/launch.json" ] || die "Debug fixture has no .vscode/launch.json at ${FIXTURE_DEST}"

# The Functions fixture, staged the same way and for the same reason.
rm -rf "$LOCALDEV_DEST"
cp -R "$LOCALDEV_SRC" "$LOCALDEV_DEST"
rm -rf "${LOCALDEV_DEST}/.eval" "${LOCALDEV_DEST}/node_modules"
[ -f "${LOCALDEV_DEST}/.vscode/launch.json" ] || die "stage-local-dev has no .vscode/launch.json at ${LOCALDEV_DEST}"

# --- stage the graders and build the config ----------------------------------
#
# The `exec:` assertions run the real Vally validators inside the container, so
# their sources have to travel with the run. Staged on every invocation —
# including --skip-build — because they are source files read straight off the
# working tree: staging a stale copy would grade the wrong contract.
# The debug graders import `jsonc-parser` (launch.json is JSON with comments), and
# the container has no install step, so the package has to travel with the staged
# tree. Staging is a *copy*, so it needs the package to exist on disk somewhere —
# it cannot be conjured on a host where nothing was ever installed.
#
# stage-graders.ts looks in the repo root as well as evals/, and the repo root is
# where `jsonc-parser` actually lives (it is a declared dependency of the
# extension). So this only has to run in the one case neither is populated, which
# keeps the "a stimulus run on a bare host costs nothing" property for every host
# that has installed either.
if [ ! -d "${REPO_ROOT}/node_modules/jsonc-parser" ] && [ ! -d "${HERE}/../node_modules/jsonc-parser" ]; then
    log "Installing eval dependencies (needed to stage graders)"
    ( cd "${HERE}/.." && npm install )
fi

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

# A stack-generated stimulus has no header to carry `# seed:`, and passing $STIMULUS
# here would seed from a stimulus the run never uses — which is exactly what happened:
# a `--stack ... --phase local` run seeded from the default `photo-app-requirements`,
# got `none`, and handed the scaffold agent a turn telling it to execute an
# `.azure/project-plan.md` that was not there. Every gate then redded on an empty
# workspace, for a reason with nothing to do with the product.
if [ -n "$STACK" ]; then
    node "${HERE}/stage-workspace.ts" --phase "${PHASE:-plan}"
else
    node "${HERE}/stage-workspace.ts" "$STIMULUS"
fi

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
    node "${HERE}/build-config.ts" --stack "$STACK" ${PHASE:+--phase "$PHASE"} ${MODEL:+--model "$MODEL"}
else
    [ -z "$PHASE" ] || die "--phase applies only with --stack; a stimulus selects its phase with its own '# phase:' directive"
    log "Building config for stimulus '${STIMULUS}'"
    node "${HERE}/build-config.ts" "$STIMULUS" ${MODEL:+--model "$MODEL"}
fi

if [ "$BUILD_ONLY" -eq 1 ]; then
    log "Build only; not submitting."
    exit 0
fi

# --- preflight ---------------------------------------------------------------

command -v az >/dev/null || die "Azure CLI not found. Install it, then run: az login"
az account show >/dev/null 2>&1 || die "Not logged in to Azure. Run: az login"

# msbench-cli needs 3.10+; macOS still ships 3.9 as python3, and on Windows
# python3 is usually the WindowsApps stub, so plain python is the real one.
PYTHON=""
for candidate in python3.12 python3.11 python3.10 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && \
       "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then
        PYTHON="$candidate"; break
    fi
done
[ -n "$PYTHON" ] || die "Need Python 3.10+ for msbench-cli. macOS: brew install python@3.12"

# Windows venvs put executables in Scripts/ with an .exe suffix, not bin/.
VENV_BIN="bin"; VENV_EXE=""
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) VENV_BIN="Scripts"; VENV_EXE=".exe" ;;
esac

# --- msbench-cli -------------------------------------------------------------

if [ ! -x "${VENV}/${VENV_BIN}/msbench-cli${VENV_EXE}" ]; then
    log "Installing msbench-cli into ${VENV} (using $($PYTHON --version))"
    "$PYTHON" -m venv "$VENV"
    "${VENV}/${VENV_BIN}/python${VENV_EXE}" -m pip install --quiet --upgrade pip

    # Token goes in the index URL rather than via keyring, which otherwise drops
    # into an interactive prompt and hangs a non-tty shell.
    log "Acquiring Azure DevOps feed token"
    ADO_TOKEN="$(az account get-access-token --resource "$ADO_RESOURCE" --query accessToken -o tsv)" \
        || die "Could not get a DevOps token. Request the 'MSBench User' role at https://aka.ms/msbench/access"

    PIP_INDEX_URL="https://msbench:${ADO_TOKEN}@pkgs.dev.azure.com/devdiv/_packaging/MicrosoftSweBench/pypi/simple/" \
        "${VENV}/${VENV_BIN}/python${VENV_EXE}" -m pip install --quiet "${PIP_NET_FLAGS[@]}" "$MSBENCH_CLI_SPEC" "$MSBENCH_VSCODE_SPEC" \
        || die "msbench-cli install failed. Confirm feed access at https://aka.ms/msbench/access"
    unset ADO_TOKEN
fi
log "msbench-cli $("${VENV}/${VENV_BIN}/msbench-cli${VENV_EXE}" version 2>/dev/null | tail -1)"

# Special agents are discovered as console scripts on PATH, not as imports, so
# calling the msbench-cli in ${VENV}/${VENV_BIN} directly reports every plugin
# as "not installed". This is the equivalent of activating the venv.
export PATH="${VENV}/${VENV_BIN}:${PATH}"

# msbench-cli depends on this, but a plugin missing from PATH and one missing
# from site-packages produce the same error, so verify the real thing.
if ! "${VENV}/${VENV_BIN}/python${VENV_EXE}" -m pip show msbench-agent-vscode >/dev/null 2>&1; then
    log "Installing the vscode special agent plugin"
    ADO_TOKEN="$(az account get-access-token --resource "$ADO_RESOURCE" --query accessToken -o tsv)"
    PIP_INDEX_URL="https://msbench:${ADO_TOKEN}@pkgs.dev.azure.com/devdiv/_packaging/MicrosoftSweBench/pypi/simple/" \
        "${VENV}/${VENV_BIN}/python${VENV_EXE}" -m pip install --quiet "${PIP_NET_FLAGS[@]}" "$MSBENCH_VSCODE_SPEC" \
        || die "Could not install msbench-agent-vscode"
    unset ADO_TOKEN
fi

# --- submit ------------------------------------------------------------------

# assets/ is shared mutable state: every invocation rewrites user-overrides.yaml
# before uploading it. Two overlapping runs therefore race, and the loser
# silently submits the winner's stimulus -- a run that looks entirely normal but
# grades the wrong prompt. Serialise instead.
#
# Ctrl-C, or killing this script, does NOT cancel the run. Submission hands the
# work to a server-side queue and everything after it is just a progress
# monitor, so a killed run.sh leaves the run executing remotely -- and CES
# dispatches one run at a time per user, so it also blocks every later
# submission. That looks like an infrastructure stall rather than a local
# mistake: the next run sits at "waiting to dispatch to GitHub Actions" for
# hours with no indication of what it is waiting for. Observed 2026-08-27, when
# a killed run held the queue for 2h11m. To abandon a run, cancel it for real:
#
#     msbench-cli status --run_id <id>   # "in progress" means still running
#     msbench-cli cancel --run_id <id>
#
# then remove this lock if the killed run.sh did not run its EXIT trap.
LOCK="${ASSETS}/.run.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
    die "Another run.sh is using ${ASSETS} (lock: ${LOCK}).
    Concurrent runs would submit each other's stimulus. Wait for it to finish,
    or remove the lock if no run.sh is alive."
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

# --- budget preflight ---------------------------------------------------------
#
# A run voided by RATE_LIMIT costs the same ~250k tokens as a real one and yields
# nothing. Seven of twenty instances in the local cache are void for that reason,
# so a third of the corpus is noise that `gate-health` has to discard.
#
# The throttle is cumulative rather than a rolling window, which is why "wait 15
# minutes" is not sufficient advice: measured on 2026-08-28, a run submitted two
# hours after the previous one still throttled after 71 calls, while the first run
# of the day completed 102 untouched. So the marker is only cleared by a run that
# actually succeeds — time alone does not clear it.
THROTTLE_MARKER="${HERE}/.last-throttle"
COOLDOWN_MINUTES="${COR_COOLDOWN_MINUTES:-45}"
if [ "$IGNORE_COOLDOWN" -eq 0 ] && [ -f "$THROTTLE_MARKER" ]; then
    LAST_THROTTLE="$(cat "$THROTTLE_MARKER" 2>/dev/null || echo 0)"
    ELAPSED_MIN=$(( ( $(date +%s) - LAST_THROTTLE ) / 60 ))
    if [ "$ELAPSED_MIN" -lt "$COOLDOWN_MINUTES" ]; then
        die "The last run was voided by RATE_LIMIT ${ELAPSED_MIN} minute(s) ago.
    Submitting now most likely buys another void run at full token cost. The
    budget is cumulative, so it recovers slowly once spent.

    Wait until ${COOLDOWN_MINUTES} minutes have passed, or override with
    --ignore-cooldown if you have reason to believe it has recovered.
    Set COR_COOLDOWN_MINUTES to change the window."
    fi
fi

log "Submitting to MSBench (benchmark: ${BENCHMARK}, stimulus: ${STIMULUS})"
# Echo the prompt actually being submitted, so a stimulus/config mismatch is
# visible in the log rather than only discoverable by unzipping the results.
sed -n '/^promptSteps:/,/assertions:/p' "${ASSETS}/user-overrides.yaml" \
    | sed -n '2,4p' | sed 's/^/    | /'
echo

# The XXXXXX suffix is required, not decorative. BSD mktemp (macOS) accepts a bare
# `-t PREFIX` and appends its own randomness; GNU mktemp (Linux) treats the whole
# argument as a template and fails with "too few X's in template" unless it ends in
# at least three X. Every developer machine here is macOS, so `-t msbench-run`
# worked everywhere it was ever run and broke the first time it ran on
# ubuntu-latest. The suffixed form is accepted by both.
RUN_LOG="$(mktemp -t msbench-run.XXXXXX)"
trap 'rm -f "$RUN_LOG"; rmdir "$LOCK" 2>/dev/null || true' EXIT

set +e
"${VENV}/${VENV_BIN}/msbench-cli${VENV_EXE}" run \
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
if [ -z "$RUN_ID" ] && [ "$CLI_STATUS" -eq 0 ]; then
    # The CLI reported success without printing a run id, so there is nothing to
    # fetch and nothing to verify. Same ruling as the missing-results branch
    # below: unknown is reported as failure, because an exit code cannot say
    # "we could not tell" and the reader will take 0 as "it passed".
    echo "ERROR: msbench-cli exited 0 but printed no run_id, so no results could be" >&2
    echo "located and this run is UNVERIFIED. Reported as a failure rather than a pass." >&2
    exit 70
fi
if [ -n "$RUN_ID" ]; then
    # msbench-cli writes to `<data_dir>/<run_id>/results.zip`. The default data_dir
    # is platform-specific — msbench uses AppDirs("msbench", "Microsoft"), so it is
    # Application Support on macOS, XDG on Linux, and LOCALAPPDATA\Microsoft on
    # Windows — and `--data_dir` overrides it outright — note the default already
    # ends in `runs`, so a custom value does NOT get a `runs` component appended.
    RESULTS_CANDIDATES=(
        "${HOME}/Library/Application Support/msbench/runs/${RUN_ID}/results.zip"
        "${HOME}/.local/share/msbench/runs/${RUN_ID}/results.zip"
    )
    if [ -n "${LOCALAPPDATA:-}" ]; then
        RESULTS_CANDIDATES+=("$(cygpath -u "$LOCALAPPDATA" 2>/dev/null || echo "$LOCALAPPDATA")/Microsoft/msbench/runs/${RUN_ID}/results.zip")
    fi
    [ -n "$DATA_DIR" ] && RESULTS_CANDIDATES=("${DATA_DIR}/${RUN_ID}/results.zip" "${RESULTS_CANDIDATES[@]}")

    RESULTS_ZIP=""
    for candidate in "${RESULTS_CANDIDATES[@]}"; do
        if [ -f "$candidate" ]; then RESULTS_ZIP="$candidate"; break; fi
    done

    if [ -z "$RESULTS_ZIP" ]; then
        # Loud AND fatal. verify-run.ts is what distinguishes a genuine result from
        # a throttled one or one answered by the wrong model, and check-assertions.ts
        # is what says whether the assertions held. Neither can run without the
        # results, so at this point the run's verdict is simply unknown.
        #
        # Unknown is reported as failure, not as success. "We could not tell" and
        # "it passed" are the same thing to anyone reading an exit code, and the
        # whole reason this block exists is that the second reading is
        # unrecoverable — nobody investigates green. Exit 70 (EX_SOFTWARE) rather
        # than 1, so an unverifiable run is distinguishable from a genuinely red
        # one; a harness problem and a product regression need different people.
        echo "ERROR: run ${RUN_ID} completed but results.zip was not found, so neither" >&2
        echo "verify-run.ts nor check-assertions.ts could run. This run is UNVERIFIED:" >&2
        echo "a throttled run, a wrong-model run, and a run whose assertions failed all" >&2
        echo "look identical from here. Reported as a failure rather than a pass." >&2
        printf '  looked in: %s\n' "${RESULTS_CANDIDATES[@]}" >&2
        exit 70
    else
        SCRATCH="$(mktemp -d)"
        unzip -oq "$RESULTS_ZIP" -d "$SCRATCH" 2>/dev/null || true
        find "$SCRATCH" -name '*-output.zip' -exec unzip -oq {} -d "${SCRATCH}/out" \; 2>/dev/null || true

        set +e
        node "${HERE}/verify-run.ts" --run-dir "${SCRATCH}/out" --run-id "$RUN_ID"
        VERIFY_STATUS=$?
        set -e

        # Remember a throttle, so the NEXT invocation can refuse to spend another
        # ~250k tokens discovering the same thing. Recorded here rather than inside
        # verify-run.ts because verify-run is also the offline --self-test entry
        # point and a self-test must not write budget state.
        if [ "$VERIFY_STATUS" -eq 75 ]; then
            date +%s > "${THROTTLE_MARKER}"
        else
            rm -f "${THROTTLE_MARKER}"
        fi

        if [ "$VERIFY_STATUS" -ne 0 ]; then
            rm -rf "$SCRATCH"
            exit "$VERIFY_STATUS"
        fi

        # Only reached when the run IS a result. verify-run.ts answers "is this
        # real" — throttled (75), wrong model (65) — and deliberately not "did it
        # pass", because a detector for false reds that also hides true reds is
        # worthless. So nothing was asking whether the assertions held.
        #
        # Run 2026082668713928 is what that cost: 4 assertions passed, 2 failed,
        # and msbench-cli exited 0, run.sh exited 0, and the GitHub job reported
        # success. A red run reporting green is the worst direction for this to
        # point, because nothing downstream contradicts it and nobody
        # investigates green.
        set +e
        node "${HERE}/check-assertions.ts" "${SCRATCH}/out"
        ASSERTIONS_STATUS=$?
        set -e

        rm -rf "$SCRATCH"
        if [ "$ASSERTIONS_STATUS" -ne 0 ]; then
            exit "$ASSERTIONS_STATUS"
        fi
    fi
fi

exit "$CLI_STATUS"
