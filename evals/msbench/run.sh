#!/usr/bin/env bash
#
# Run an eval suite on MSBench.
#
# Builds the extension VSIX, assembles the agent assets for the chosen suite, and
# submits a run. Everything the run needs is derived here, so a clean machine with
# `az login` already done should be able to execute this unmodified.
#
# Usage:
#   ./run.sh                                   # project-plan; submit and stream progress
#   ./run.sh --suite scaffold-unapproved-plan  # pick a suite (see stage.mjs --list)
#   ./run.sh --skip-build                      # reuse the VSIX already staged
#   ./run.sh --build-only                      # build and verify the VSIX, then stop
#
# The scaffold suites start from real planning-agent output, so run the seed suites and
# harvest them once before the first scaffold suite (see harvest-seed.mjs --check).
#
set -euo pipefail

SKIP_BUILD=0
BUILD_ONLY=0
SUITE="project-plan"
PASSTHRU=()
# `--suite <name>` takes a value, so consume the next argument rather than letting it
# fall through to PASSTHRU and reach msbench-cli as an unknown positional.
WANT_SUITE=0
for arg in "$@"; do
    if [ "$WANT_SUITE" -eq 1 ]; then
        SUITE="$arg"; WANT_SUITE=0; continue
    fi
    case "$arg" in
        --skip-build) SKIP_BUILD=1 ;;
        --build-only) BUILD_ONLY=1 ;;
        --suite) WANT_SUITE=1 ;;
        --suite=*) SUITE="${arg#--suite=}" ;;
        *) PASSTHRU+=("$arg") ;;
    esac
done
if [ "$WANT_SUITE" -eq 1 ]; then
    printf '\033[1;31mERROR:\033[0m --suite needs a value\n' >&2
    exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
ASSETS="${HERE}/assets"
VSIX_DEST="${ASSETS}/extensions/vscode-azureresourcegroups.vsix"
# What actually gets uploaded. stage.mjs assembles it per suite: the chosen config as
# user-overrides.yaml, the bundled graders, and (for the scaffold suites) the generated
# plan to seed the workspace with. Built fresh each run, so `assets/` stays pristine.
STAGED="${HERE}/.staged"

# Borrowed purely for its container image; user-overrides.yaml replaces its
# prompt and assertions wholesale. Swapping this for a heavier instance is how
# we would get a richer starting workspace later.
BENCHMARK="${BENCHMARK:-vscbench.say_hello}"

# Resource id of the Azure DevOps first-party app, used to mint a feed token.
ADO_RESOURCE="499b84ac-1321-427f-aa17-267ca6975798"
VENV="${MSBENCH_VENV:-${HOME}/.msbench-venv}"
FEED_URL="https://pkgs.dev.azure.com/devdiv/_packaging/MicrosoftSweBench/pypi/simple/"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# pip reports a 403 from the feed as "No matching distribution found", which reads
# like the package does not exist rather than like a permissions problem. Ask the
# feed directly so the failure names the actual cause.
diagnose_feed() {
    local token="$1" status body
    status="$(curl -s -o /tmp/msbench-feed.$$ -w '%{http_code}' -u "msbench:${token}" "${FEED_URL}msbench-cli/" 2>/dev/null)" || status="000"
    body="$(head -c 400 "/tmp/msbench-feed.$$" 2>/dev/null)"
    rm -f "/tmp/msbench-feed.$$"

    case "$status" in
        200) printf 'The feed is reachable and grants access, so this is not a permissions problem.\n' ;;
        401) printf 'The feed rejected the token (401). Try `az logout && az login`.\n' ;;
        403)
            printf 'The feed refused the request (403) for the signed-in identity:\n\n  %s\n\n' "$(sed -n 's/.*"message":"\([^"]*\)".*/\1/p' <<<"$body")"
            printf 'You are authenticated but not entitled. Request the "MSBench User" role\n'
            printf 'at https://aka.ms/msbench/access (-> gaining-access), then re-run.\n'
            printf 'Signed in as: %s\n' "$(az account show --query user.name -o tsv 2>/dev/null || echo unknown)"
            ;;
        000) printf 'Could not reach the feed at all. Check network/VPN.\n' ;;
        *)   printf 'The feed returned HTTP %s:\n%s\n' "$status" "$body" ;;
    esac
}

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
# A correct VSIX is ~7 MB. The guards above only check that two paths are present, so
# they stayed green while eval output under the repo-root `results/` was being packaged
# in — a 113 MB VSIX that still "looked" valid and was slow to upload.
VSIX_BYTES="$(wc -c < "$VSIX_DEST" | tr -d ' ')"
if [ "$VSIX_BYTES" -gt 41943040 ]; then
    die "VSIX is $((VSIX_BYTES / 1048576)) MB; expected ~7 MB. Something untracked is being packaged — check .vscodeignore (the repo-root results/ directory is the usual culprit)."
fi

log "Staged $(basename "$BUILT_VSIX" 2>/dev/null || basename "$VSIX_DEST") ($(du -h "$VSIX_DEST" | cut -f1))"

if [ "$BUILD_ONLY" -eq 1 ]; then
    log "Build only; not submitting."
    exit 0
fi

# --- stage the agent assets --------------------------------------------------
#
# Before the Azure preflight for the same reason the build is: a missing generated
# plan or a grader that fails to bundle should be reported without needing credentials.

log "Validating suite configs"
node "${HERE}/validate-suites.mjs" || die "Suite config validation failed."

log "Staging assets for suite '${SUITE}'"
node "${HERE}/stage.mjs" "$SUITE" || die "Staging failed for suite '${SUITE}'."

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
        "${VENV}/bin/python" -m pip install --quiet msbench-cli msbench-agent-vscode \
        || {
            printf '\033[1;31mERROR:\033[0m msbench-cli install failed.\n\n' >&2
            diagnose_feed "$ADO_TOKEN" >&2
            exit 1
        }
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
        "${VENV}/bin/python" -m pip install --quiet msbench-agent-vscode \
        || die "Could not install msbench-agent-vscode"
    unset ADO_TOKEN
fi

# --- submit ------------------------------------------------------------------

log "Submitting to MSBench (benchmark: ${BENCHMARK}, suite: ${SUITE})"
echo
exec "${VENV}/bin/msbench-cli" run \
    --agent vscode \
    --model . \
    --benchmark "$BENCHMARK" \
    --agent-assets "$STAGED" \
    ${PASSTHRU[@]+"${PASSTHRU[@]}"}
