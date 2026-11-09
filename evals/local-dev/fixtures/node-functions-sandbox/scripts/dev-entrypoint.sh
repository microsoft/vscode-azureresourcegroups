#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/copilot-on-rails-sandbox

if [[ ! -f package-lock.json ]]; then
    echo "package-lock.json is required for deterministic sandbox startup." >&2
    exit 1
fi

npm ci
touch /tmp/cor-sandbox-ready

exec "$@"
