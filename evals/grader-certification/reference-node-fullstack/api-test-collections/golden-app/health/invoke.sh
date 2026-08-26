#!/usr/bin/env bash
# Health probe for the Golden App debug configuration.
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:3000}"
curl --fail --silent --show-error "${BASE_URL}/api/health"
