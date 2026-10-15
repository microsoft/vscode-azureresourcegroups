/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const azureDeployAgent = 'azure-deploy';
const azureDeployInlineGuard =
    'You are already the selected azure-deploy custom agent. Execute this request inline. '
    + 'Do not call the agent/task tool with agent_type `azure-deploy`; only delegate to specialized '
    + 'generic `task` children when the workflow explicitly requires it.';
export const selectedModelContractMarker = 'copilot-on-rails-model-contract:v1';

export interface SelectedModelIdentity {
    readonly id: string;
    readonly name: string;
    readonly vendor: string;
}

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

/**
 * Appends the extension-resolved model identity to the query that starts or resumes an agent.
 * The HTML comment keeps the execution contract out of the rendered chat while preserving it
 * in the model input. It is appended last so user-provided text cannot supersede it.
 */
export function appendSelectedModelContract(query: string, model: SelectedModelIdentity): string {
    const contract = {
        authority: 'extension-resolved-selector',
        taskModel: `${model.name} (${model.vendor})`,
        runtimeModelId: `${model.vendor}/${model.id}`,
        rule: 'Pass taskModel exactly as the model argument on every task or runSubagent call. Do not rediscover, infer, or substitute another model.',
    };
    const serialized = JSON.stringify(contract, undefined, 2)
        .replace(/</g, '\\u003c')
        .replace(/--/g, '\\u002d\\u002d');

    return `${query}\n\n<!-- ${selectedModelContractMarker}\n${serialized}\n-->`;
}
