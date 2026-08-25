#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE.md in the project root for license information.
#---------------------------------------------------------------------------------------------
#
# Run the local development graders against a workspace on disk.
#
# Usage:
#   ./run-debug-graders.sh "/path/to/project" [extra --assert-* flags]
#
# Which graders apply depends on where the project is in the workflow, so this picks
# them by inspecting the workspace: a plan with no .vscode/launch.json is still at the
# approval gate, and anything past that is graded for generated artifacts instead.
#
# Exit codes mirror the grader contract: 0 all passed, 1 a grader reported a product
# failure, 3 a grader itself could not run.

set -uo pipefail

WORKSPACE="${1:-}"
if [[ -z "${WORKSPACE}" ]]; then
    echo "usage: $0 <workspace-path> [extra grader flags]" >&2
    exit 2
fi
shift || true

if [[ ! -d "${WORKSPACE}" ]]; then
    echo "error: '${WORKSPACE}' is not a directory." >&2
    exit 2
fi

# Resolve to an absolute path so the graders are not affected by this script's cwd.
WORKSPACE="$(cd "${WORKSPACE}" && pwd)"
GRADERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/graders"
PLAN="${WORKSPACE}/.azure/vscode-debug-plan.md"

echo "workspace: ${WORKSPACE}"

if [[ ! -f "${PLAN}" ]]; then
    echo "error: no .azure/vscode-debug-plan.md found — nothing for the local dev graders to check." >&2
    echo "       Run the azure-debug-plan agent against this project first." >&2
    exit 2
fi

if [[ -f "${WORKSPACE}/.vscode/launch.json" ]]; then
    echo "phase:     generated (.vscode/launch.json present)"
    GRADERS=(validate-debug-plan validate-debug-config validate-debug-artifacts)
else
    echo "phase:     approval gate (no .vscode/launch.json yet)"
    GRADERS=(validate-debug-gate validate-debug-plan)
fi
echo

worst=0
for grader in "${GRADERS[@]}"; do
    EVALUATE_WORKSPACE="${WORKSPACE}" \
        node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "${GRADERS_DIR}/${grader}.ts" "$@"
    status=$?
    # Exit 3 means the grader is broken, which outranks a product failure.
    if [[ ${status} -eq 3 || ${worst} -eq 0 && ${status} -ne 0 ]]; then
        worst=${status}
    fi
    echo
done

exit ${worst}
