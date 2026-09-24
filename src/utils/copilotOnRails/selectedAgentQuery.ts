/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const azureDeployAgent = 'azure-deploy';
const azureDeployInlineGuard =
    'You are already the selected azure-deploy custom agent. Execute this request inline. '
    + 'Do not call the agent/task tool with agent_type `azure-deploy`; only delegate to specialized '
    + 'generic `task` children when the workflow explicitly requires it.';

/**
 * Prevents a prompt or continuation turn from asking an already-selected custom agent to launch
 * another copy of itself. The agent instructions enforce the same invariant inside the runtime.
 */
export function guardSelectedAgentQuery(mode: string | undefined, query: string): string {
    if (mode?.trim().toLowerCase() !== azureDeployAgent || query.startsWith(azureDeployInlineGuard)) {
        return query;
    }
    return `${azureDeployInlineGuard}\n\n${query}`;
}
