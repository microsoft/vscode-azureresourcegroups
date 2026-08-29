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
# It runs the real `validate-runtime-crud` grader against a real PostgreSQL-backed app
# TWICE:
#
#   1. with PostgreSQL running  -> must PASS with a genuine write-then-read round-trip
#   2. with PostgreSQL stopped  -> must NOT pass; must stand down, exit 3
#
# The second run is the one that gives the first any meaning. A gate that passes
# because it never really reached the database would pass identically in both, and
# that failure mode is invisible from a single green result. Measured 2026-08-29 on
# msbench-1.1.0:
#
#     --- runtime-crud, postgres RUNNING ---
#     [runtime-crud] POST then GET /api/items round-tripped {"name":"cor-runtime-probe-..."}
#     PASS: gate=runtime-crud
#     --- runtime-crud, postgres STOPPED ---
#     NOT_APPLICABLE gate=runtime-crud reason=datastoreRequiresContainer  (exit 3)
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
cp -R "${EVALS}/grader-certification/reference-node-postgres" "${CTX}/app"
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

mkdir -p /tmp/azurite
nohup azurite --silent --skipApiVersionCheck --location /tmp/azurite \
  --blobHost 127.0.0.1 --queueHost 127.0.0.1 --tableHost 127.0.0.1 >/tmp/azurite.log 2>&1 &
PG_VERSION="$(cat /etc/cor-pg-version)"
pg_ctlcluster "$PG_VERSION" main start || true
for _ in $(seq 1 20); do su postgres -c "pg_isready -q" >/dev/null 2>&1 && break; sleep 1; done
su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='taskuser'\"" | grep -q 1 \
  || su postgres -c "psql -c \"CREATE ROLE taskuser LOGIN PASSWORD 'taskpassword' SUPERUSER\"" >/dev/null 2>&1
su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='tasktracker'\"" | grep -q 1 \
  || su postgres -c "createdb -O taskuser tasktracker" >/dev/null 2>&1
echo "EMU_AZURITE $( (echo > /dev/tcp/127.0.0.1/10000) >/dev/null 2>&1 && echo listening || echo DOWN)"
echo "EMU_POSTGRES $(su postgres -c 'pg_isready -q' >/dev/null 2>&1 && echo ready || echo DOWN)"

cd /workspace/app
npm install --no-audit --no-fund --registry $REG >/tmp/npm.log 2>&1 \
  || { echo "NPM_APP_FAIL"; tail -5 /tmp/npm.log; }
echo "PG_MODULE $([ -d node_modules/pg ] && echo installed || echo MISSING)"

# @microsoft/vally is internal and unreachable from here; the runtime gates do not use it.
cd /workspace/evals
npm install --no-audit --no-fund --no-save --registry $REG jsonc-parser@2 yaml@2 >/tmp/npm2.log 2>&1 \
  || { echo "NPM_EVALS_FAIL"; tail -5 /tmp/npm2.log; }

export EVALUATE_WORKSPACE=/workspace/app
echo "--- runtime-crud, postgres RUNNING (must pass) ---"
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON graders/validate-runtime-crud.ts 2>&1 | tail -20
echo "CRUD_RUNNING_EXIT ${PIPESTATUS[0]}"

echo "--- runtime-crud, postgres STOPPED (must not pass) ---"
pg_ctlcluster "$PG_VERSION" main stop >/dev/null 2>&1 || true
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON graders/validate-runtime-crud.ts 2>&1 | tail -14
echo "CRUD_STOPPED_EXIT ${PIPESTATUS[0]}"
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

# The assertions. Both are required, and the second is not optional politeness: without
# it a gate that silently stopped exercising the database would report success here.
RUNNING_EXIT="$(sed -n 's/^CRUD_RUNNING_EXIT \([0-9]*\).*/\1/p' "$OUT" | tail -1)"
STOPPED_EXIT="$(sed -n 's/^CRUD_STOPPED_EXIT \([0-9]*\).*/\1/p' "$OUT" | tail -1)"

[ -n "$RUNNING_EXIT" ] || { sed -n '$!d;p' "$OUT"; die "the probe did not report a result; see the log above"; }
[ "$RUNNING_EXIT" = "0" ] \
    || die "runtime-crud did not pass with PostgreSQL running (exit ${RUNNING_EXIT}). The emulators are not reaching the gate."
[ "$STOPPED_EXIT" = "3" ] \
    || die "runtime-crud returned ${STOPPED_EXIT} with PostgreSQL stopped; expected 3 (stand-down). A gate that does not notice the database is gone is not testing it."

log "PASS: runtime-crud passes against a live PostgreSQL and stands down without one."
