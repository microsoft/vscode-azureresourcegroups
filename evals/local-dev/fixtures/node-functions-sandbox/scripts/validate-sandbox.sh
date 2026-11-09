#!/usr/bin/env bash
set -euo pipefail

fixture_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${fixture_dir}"

export COMPOSE_PROJECT_NAME=cor-node-functions-sandbox-validation
export FRONTEND_PORT=15173
export FUNCTIONS_PORT=17071
export NODE_INSPECTOR_PORT=19229
export AZURITE_BLOB_PORT=11000
export AZURITE_QUEUE_PORT=11001
export AZURITE_TABLE_PORT=11002
export POSTGRES_PORT=15432

cleanup() {
    status=$?
    if [[ ${status} -ne 0 ]]; then
        docker compose exec -T dev sh -c \
            'printf "%s\n" "--- API log ---"; cat /tmp/api.log 2>/dev/null || true; printf "%s\n" "--- Web log ---"; cat /tmp/web.log 2>/dev/null || true' \
            >&2 || true
    fi
    docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
    rm -rf services/api/dist services/web/dist
    chmod -N node_modules 2>/dev/null || true
    rmdir node_modules 2>/dev/null || true
    return "${status}"
}
trap cleanup EXIT

docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
docker compose config --quiet
node scripts/validate-host-f5-config.mjs
grep -F \
    'FROM mcr.microsoft.com/devcontainers/javascript-node:22-bookworm@sha256:33cc368bc8ce9dac872703c7b9ebf6dabcc7b14bbb8cfd2b64be0e7232e3a361' \
    Dockerfile >/dev/null
test ! -e .devcontainer/devcontainer.json
! grep -R -F 'ms-vscode-remote.remote-containers' .vscode Dockerfile compose.yaml package.json
docker compose up --build --wait dev

test "$(docker compose exec -T dev id -u)" = "1000"
test "$(docker compose exec -T dev stat -c '%u:%g' node_modules)" = "1000:1000"
docker compose exec -T dev test -w node_modules
test "$(docker compose exec -T dev node --version)" = "v22.23.4"
test "$(docker compose exec -T dev npm --version)" = "10.9.9"
test "$(docker compose exec -T dev pnpm --version)" = "12.16.1"
test "$(docker compose exec -T dev yarn --version)" = "1.22.22"
docker compose exec -T dev git --version >/dev/null
docker compose exec -T dev sh -lc 'command -v dig && command -v nc' >/dev/null
docker compose exec -T dev psql --version >/dev/null
docker compose exec -T dev az --version >/dev/null
test "$(docker compose exec -T dev func --version)" = "4.16.0"

docker compose exec -T -d \
    -e languageWorkers__node__arguments=--inspect=0.0.0.0:9229 \
    dev sh -c 'npm run dev:api >/tmp/api.log 2>&1'
docker compose exec -T -d dev sh -c 'npm run dev:web >/tmp/web.log 2>&1'

health_response="$(
    curl --fail --silent --show-error --retry 30 --retry-delay 1 --retry-all-errors \
        "http://localhost:${FUNCTIONS_PORT}/api/health"
)"
node -e '
const health = JSON.parse(process.argv[1]);
if (health.status !== "ok" || health.services?.azurite !== "ready" || health.services?.postgres !== "ready") {
    throw new Error(`Unexpected health response: ${process.argv[1]}`);
}
' "${health_response}"
docker compose exec -T dev grep -F "health: [GET]" /tmp/api.log >/dev/null
docker compose exec -T dev sh -c '! grep -F "Found zero files" /tmp/api.log'
test -f services/api/dist/src/functions/health.js.map
inspector_response="$(
    curl --fail --silent --show-error --retry 30 --retry-delay 1 --retry-all-errors \
        "http://localhost:${NODE_INSPECTOR_PORT}/json/list"
)"
node -e '
const targets = JSON.parse(process.argv[1]);
if (!Array.isArray(targets) || targets.length === 0 || !targets.some(target => target.webSocketDebuggerUrl)) {
    throw new Error(`Unexpected inspector response: ${process.argv[1]}`);
}
' "${inspector_response}"
curl --fail --silent --show-error --retry 30 --retry-delay 1 --retry-all-errors \
    "http://localhost:${FRONTEND_PORT}" >/dev/null

docker compose exec -T dev npm run check
docker compose exec -T dev npm run build
