#!/usr/bin/env bash
#
# Prove the datastore emulators are wired to the runtime gates, in the real image,
# without spending a single model token.
#
# -- Why this exists ------------------------------------------------------------
#
# `runtime-crud` reported `datastoreRequiresContainer` on every Azure-shaped project
# for as long as the gate had existed. The emulator work was supposed to change that,
# and the honest way to find out is not to submit an eval run: a run costs tokens, is
# rate-limited, takes tens of minutes, and answers a dozen questions at once, so a red
# `runtime-crud` in a run tells you almost nothing about *why*.
#
# `az acr run` executes an arbitrary command in the published image on ACR's agent
# pool. That is the same container the eval uses, minus the agent — which is exactly
# the part not under test here. So this script answers "do the emulators start, and
# does the gate use them?" in about ninety seconds, for free, as often as you like.
#
# -- What it proves, and the half people skip ------------------------------------
#
# It runs the real `validate-runtime-crud` grader against two real apps — one backed by
# PostgreSQL, one by Azure Blob Storage through Azurite — and each of them TWICE:
#
#   1. with the emulator running  -> must PASS with a genuine write-then-read round-trip
#   2. with the emulator stopped  -> must NOT pass; must stand down, exit 3
#
# The second run is the one that gives the first any meaning. A gate that passes because
# it never really reached the datastore would pass identically in both, and that failure
# mode is invisible from a single green result.
#
# Both datastores are covered because their failure modes differ. PostgreSQL either
# accepts a connection or does not. Azurite accepts connections and can still be useless:
# it rejects storage API versions newer than the ones it knows, so a current SDK gets a
# hard error from an emulator that is running perfectly — which a port probe cannot see,
# and only a round-trip through the SDK can.
#
# Measured 2026-08-29 on msbench-1.1.0:
#
#     EMU_AZURITE listening / EMU_POSTGRES ready
#     PG_RUNNING_EXIT 0    BLOB_RUNNING_EXIT 0
#     PG_STOPPED_EXIT 3    BLOB_STOPPED_EXIT 3
#
# Usage:  bash evals/msbench/container/verify-emulators.sh
# Requires: az (logged in), and push/run access to the registry.

set -euo pipefail

# See build-image.sh: the Azure CLI streams remote logs through a cp1252 console on
# Windows and dies on the first non-ASCII byte, truncating the log *after* the remote
# command has already run. That cost a wrong conclusion once already.
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"

REGISTRY="${COR_ACR_NAME:-cormsbench}"
INSTANCE="${COR_INSTANCE_ID:-cor_functions_host}"
SUITE="${COR_SUITE:-vscbench}"

HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
EVALS="$(CDPATH= cd -- "${HERE}/../.." && pwd)"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

command -v az >/dev/null 2>&1 || die "Azure CLI not found. Install it, then run: az login"

VERSION="$(python -c 'import json,sys;print(json.load(open(sys.argv[1]))["image_version"])' \
    "${HERE}/instances/${INSTANCE}/metadata.json" 2>/dev/null || true)"
[ -n "$VERSION" ] || die "Could not read image_version from instances/${INSTANCE}/metadata.json"
IMAGE="${REGISTRY}.azurecr.io/${SUITE}.eval.x86_64.${INSTANCE}:msbench-${VERSION}"

CTX="$(mktemp -d)"
# `|| true` because the cleanup must never decide this script's exit code. On Windows
# the temp directory is intermittently held by the CLI's own upload and `rm` fails with
# "Device or resource busy", which turned a passing verification into exit 1.
trap 'rm -rf "$CTX" 2>/dev/null || true' EXIT

log "Assembling probe context for ${IMAGE}"
mkdir -p "${CTX}/evals"
# Source only. node_modules is deliberately not shipped: it is large, platform-specific,
# and the probe installs the two public packages the graders actually import.
cp -R "${EVALS}/graders" "${CTX}/evals/graders"
cp -R "${EVALS}/src" "${CTX}/evals/src"
cp -R "${EVALS}/grader-certification/reference-node-postgres" "${CTX}/app-postgres"
cp -R "${EVALS}/grader-certification/reference-node-blob" "${CTX}/app-blob"
for f in package.json tsconfig.json; do
    [ -f "${EVALS}/${f}" ] && cp "${EVALS}/${f}" "${CTX}/evals/${f}"
done
find "${CTX}" -name 'node_modules' -type d -prune -exec rm -rf {} + 2>/dev/null || true

cat > "${CTX}/probe.sh" <<'PROBE'
#!/usr/bin/env bash
set -u
echo "BEGIN_CRUD_PROBE"
# azurite installs into the active Node version's bin, which is not guaranteed to be on
# PATH in a non-login shell. Sourcing is a no-op when it already is.
[ -s /opt/nvm/nvm.sh ] && . /opt/nvm/nvm.sh >/dev/null 2>&1 || true
REG=https://registry.npmjs.org/

start_azurite() {
  mkdir -p /tmp/azurite
  nohup azurite --silent --skipApiVersionCheck --location /tmp/azurite \
    --blobHost 127.0.0.1 --queueHost 127.0.0.1 --tableHost 127.0.0.1 >/tmp/azurite.log 2>&1 &
  for _ in $(seq 1 20); do (echo > /dev/tcp/127.0.0.1/10000) >/dev/null 2>&1 && break; sleep 1; done
}

PG_VERSION="$(cat /etc/cor-pg-version)"
start_azurite
pg_ctlcluster "$PG_VERSION" main start || true
for _ in $(seq 1 20); do su postgres -c "pg_isready -q" >/dev/null 2>&1 && break; sleep 1; done
su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='taskuser'\"" | grep -q 1 \
  || su postgres -c "psql -c \"CREATE ROLE taskuser LOGIN PASSWORD 'taskpassword' SUPERUSER\"" >/dev/null 2>&1
su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='tasktracker'\"" | grep -q 1 \
  || su postgres -c "createdb -O taskuser tasktracker" >/dev/null 2>&1
echo "EMU_AZURITE $( (echo > /dev/tcp/127.0.0.1/10000) >/dev/null 2>&1 && echo listening || echo DOWN)"
echo "EMU_POSTGRES $(su postgres -c 'pg_isready -q' >/dev/null 2>&1 && echo ready || echo DOWN)"

for app in postgres blob; do
  cd "/workspace/app-${app}"
  npm install --no-audit --no-fund --registry $REG >"/tmp/npm-${app}.log" 2>&1 \
    || { echo "NPM_APP_FAIL ${app}"; tail -5 "/tmp/npm-${app}.log"; }
done
echo "PG_MODULE $([ -d /workspace/app-postgres/node_modules/pg ] && echo installed || echo MISSING)"
echo "BLOB_MODULE $([ -d /workspace/app-blob/node_modules/@azure/storage-blob ] && echo installed || echo MISSING)"

# @microsoft/vally is internal and unreachable from here; the runtime gates do not use it.
cd /workspace/evals
npm install --no-audit --no-fund --no-save --registry $REG jsonc-parser@2 yaml@2 >/tmp/npm2.log 2>&1 \
  || { echo "NPM_EVALS_FAIL"; tail -5 /tmp/npm2.log; }

crud() {
  # $1 = app directory suffix, $2 = marker name
  cd /workspace/evals
  EVALUATE_WORKSPACE="/workspace/app-$1" \
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON graders/validate-runtime-crud.ts 2>&1 | tail -18
  echo "$2 ${PIPESTATUS[0]}"
}

echo "--- runtime-crud / postgres, database RUNNING (must pass) ---"
crud postgres PG_RUNNING_EXIT
echo "--- runtime-crud / postgres, database STOPPED (must stand down) ---"
pg_ctlcluster "$PG_VERSION" main stop >/dev/null 2>&1 || true
crud postgres PG_STOPPED_EXIT

echo "--- runtime-crud / blob, Azurite RUNNING (must pass) ---"
crud blob BLOB_RUNNING_EXIT
echo "--- runtime-crud / blob, Azurite STOPPED (must stand down) ---"
# pkill rather than a recorded PID: azurite forks, and killing the shell's job leaves the
# listener up, which would make the stopped case pass for the wrong reason.
pkill -f azurite >/dev/null 2>&1 || true
for _ in $(seq 1 15); do (echo > /dev/tcp/127.0.0.1/10000) >/dev/null 2>&1 || break; sleep 1; done
echo "AZURITE_AFTER_KILL $( (echo > /dev/tcp/127.0.0.1/10000) >/dev/null 2>&1 && echo STILL_UP || echo down)"
crud blob BLOB_STOPPED_EXIT
echo "END_CRUD_PROBE"
PROBE

cat > "${CTX}/task.yaml" <<TASK
version: v1.1.0
steps:
  - cmd: '${IMAGE} bash -c "mkdir -p /workspace && cp -r /probe/. /workspace/ && cd /workspace && bash probe.sh"'
    workingDirectory: /probe
TASK

find "${CTX}" -name '*.sh' -exec sed -i 's/\r$//' {} \;

log "Running the gate in ${IMAGE}"
OUT="${CTX}/out.log"
( cd "$CTX" && az acr run --registry "$REGISTRY" -f task.yaml . ) > "$OUT" 2>&1 || true
sed -n '/BEGIN_CRUD_PROBE/,/END_CRUD_PROBE/p' "$OUT" || true

# The assertions. Each emulator is checked in both directions, and the "stopped" half is
# not optional politeness: without it a gate that had silently stopped exercising the
# datastore would report success here, which is the failure this script exists to catch.
expect() {
    # $1 = marker, $2 = expected exit, $3 = what a mismatch means
    local actual
    actual="$(sed -n "s/^$1 \([0-9]*\).*/\1/p" "$OUT" | tail -1)"
    [ -n "$actual" ] || die "the probe never reported $1; see the log above"
    [ "$actual" = "$2" ] || die "$1 was ${actual}, expected ${2} — $3"
}

# A kill that did not take would make the stopped cases pass for the wrong reason.
grep -q '^AZURITE_AFTER_KILL down' "$OUT" \
    || die "Azurite was still listening after the kill, so the stopped case proves nothing"

expect PG_RUNNING_EXIT    0 "runtime-crud did not pass against a live PostgreSQL; the emulator is not reaching the gate"
expect PG_STOPPED_EXIT    3 "runtime-crud did not stand down without PostgreSQL; a gate that does not notice the database is gone is not testing it"
expect BLOB_RUNNING_EXIT  0 "runtime-crud did not pass against a live Azurite; the blob emulator is not reaching the gate"
expect BLOB_STOPPED_EXIT  3 "runtime-crud did not stand down without Azurite; a gate that does not notice storage is gone is not testing it"

log "PASS: runtime-crud passes against live PostgreSQL and Azurite, and stands down without either."
