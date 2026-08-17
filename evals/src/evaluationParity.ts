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

/**
 * Repair budgets are allocated per stage rather than as one shared pool. A shared pool lets an
 * early stage consume every retry, which starves later stages of any repair opportunity even when
 * their failure is trivially fixable.
 */
export interface StageRepairBudgets {
    readonly build: AgentRepairBudget;
    readonly integration: AgentRepairBudget;
    readonly local: AgentRepairBudget;
}

export function createStageRepairBudgets(
    maxRetriesPerStage: number | undefined,
): StageRepairBudgets {
    return {
        build: createAgentRepairBudget(maxRetriesPerStage),
        integration: createAgentRepairBudget(maxRetriesPerStage),
        local: createAgentRepairBudget(maxRetriesPerStage),
    };
}

export function totalUsedAgentRepairs(budgets: StageRepairBudgets): number {
    return budgets.build.usedRetries
        + budgets.integration.usedRetries
        + budgets.local.usedRetries;
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
