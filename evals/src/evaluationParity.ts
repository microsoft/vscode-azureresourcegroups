/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AgentRepairBudget {
    readonly maxRetries: number;
    usedRetries: number;
}

export interface ModelPinFailure {
    code: 'modelMismatch' | 'modelNotObserved';
    message: string;
}

export function createAgentRepairBudget(
    maxRetries: number | undefined,
    initialRetries = 0,
): AgentRepairBudget {
    const resolvedMaxRetries = maxRetries ?? 2;
    if (!Number.isInteger(resolvedMaxRetries) || resolvedMaxRetries < 0) {
        throw new Error(`Agent repair limit must be a non-negative integer, received ${resolvedMaxRetries}.`);
    }
    if (!Number.isInteger(initialRetries) || initialRetries < 0) {
        throw new Error(`Initial agent repair count must be a non-negative integer, received ${initialRetries}.`);
    }
    if (initialRetries > resolvedMaxRetries) {
        throw new Error(
            `Initial agent repair count ${initialRetries} exceeds the maximum retry budget ${resolvedMaxRetries}.`,
        );
    }
    return {
        maxRetries: resolvedMaxRetries,
        usedRetries: initialRetries,
    };
}

export function tryConsumeAgentRepair(budget: AgentRepairBudget): number | undefined {
    if (budget.usedRetries >= budget.maxRetries) {
        return undefined;
    }
    budget.usedRetries++;
    return budget.usedRetries;
}

export function validatePinnedModel(
    requestedModel: string | undefined,
    observedModels: readonly string[],
): ModelPinFailure | undefined {
    if (!requestedModel) {
        return undefined;
    }
    if (!observedModels.length) {
        return {
            code: 'modelNotObserved',
            message: `No model was observed for requested model "${requestedModel}".`,
        };
    }
    const uniqueObservedModels = [...new Set(observedModels)];
    if (uniqueObservedModels.some(model => model !== requestedModel)) {
        return {
            code: 'modelMismatch',
            message: `Requested model "${requestedModel}" but observed ${JSON.stringify(uniqueObservedModels)}.`,
        };
    }
    return undefined;
}

export function shouldValidateIntegrationOutput(through: 'scaffold' | 'local'): boolean {
    return through === 'local';
}
