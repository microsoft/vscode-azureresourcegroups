#!/usr/bin/env bash
# ---------------------------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See LICENSE.md in the project root for license information.
# ---------------------------------------------------------------------------------------------

# Health probe for the Golden App debug configuration.
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:3000}"
curl --fail --silent --show-error "${BASE_URL}/api/health"
