/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { CorAgentRunResult } from '../../src/utils/copilotOnRails/agentExecution/CorAgentExecutor';
import {
    BaselineAttemptInput,
    BaselineScenario,
    runBaselineAttempt,
} from '../../evals/src/baseline';
import {
    createAgentRepairBudget,
    tryConsumeAgentRepair,
    validatePinnedModel,
} from '../../evals/src/evaluationParity';

const repoRoot = path.resolve(__dirname, '..', '..');
const resultsRoot = path.join(repoRoot, 'evals', 'results');
const model = 'pinned-test-model';

suite('Baseline merit parity', () => {
    test('scaffold evaluates project commands without applying integration merits', async () => {
        await withScratch(async scratch => {
            const result = await runBaselineAttempt(await createInput(scratch));

            assert.equal(result.outcome, 'autonomous_success');
            assert.deepEqual(result.stages.map(stage => stage.name), ['scaffold', 'build']);
            assert.equal(result.agentRetries, 0);
        });
    });

    test('shares one baseline repair budget across build and integration', async () => {
        await withScratch(async scratch => {
            let projectValidationCalls = 0;
            const input = await createInput(scratch, {
                through: 'local',
                scenario: createScenario({
                    tags: {
                        archetype: 'crud',
                        frontend: 'react',
                        backend: 'typescript-functions',
                    },
                }),
                projectValidator: {
                    validate: async () => {
                        projectValidationCalls++;
                        return projectValidationCalls === 1
                            ? {
                                outcome: 'failed',
                                failureCode: 'noBuildTargets',
                                error: 'Build failed.',
                                commands: [],
                            }
                            : { outcome: 'passed', commands: [] };
                    },
                },
            });

            const result = await runBaselineAttempt(input);

            assert.equal(result.outcome, 'failed');
            assert.equal(result.failedStage, 'integration');
            assert.equal(result.failureCode, 'integrationValidationFailed');
            assert.equal(result.agentRetries, 1);
            assert.deepEqual(
                result.stages.map(stage => stage.name),
                ['scaffold', 'build', 'repair', 'build', 'integration'],
            );
        });
    });

    test('preserves cumulative repair counts when a shared budget is resumed', () => {
        const budget = createAgentRepairBudget(2, 1);

        assert.equal(tryConsumeAgentRepair(budget), 2);
        assert.equal(tryConsumeAgentRepair(budget), undefined);
        assert.equal(budget.usedRetries, 2);
        assert.throws(
            () => createAgentRepairBudget(1, 2),
            /exceeds the maximum retry budget/,
        );
    });

    test('fails closed only when an explicitly pinned treatment model is absent or differs', () => {
        assert.equal(validatePinnedModel(model, [model]), undefined);
        assert.equal(validatePinnedModel(model, [])?.code, 'modelNotObserved');
        assert.equal(validatePinnedModel(model, ['other-model'])?.code, 'modelMismatch');
        assert.equal(validatePinnedModel(undefined, [])?.code, undefined);
    });
});

function createScenario(overrides: Partial<BaselineScenario> = {}): BaselineScenario {
    return {
        schemaVersion: '1',
        id: 'baseline-merit-parity',
        prompt: 'Create an API.',
        baselinePrompt: 'Create a complete standalone TypeScript API with source, tests, linting, and local debugging.',
        tags: {
            archetype: 'api',
            frontend: 'none',
            backend: 'typescript-functions',
        },
        validation: {
            profile: 'minimal',
            build: true,
            test: true,
            lint: 'required',
            timeoutMinutes: 1,
            maxAgentRetries: 1,
        },
        ...overrides,
    };
}

async function createInput(
    scratch: string,
    overrides: Partial<BaselineAttemptInput> = {},
): Promise<BaselineAttemptInput> {
    const outputDirectory = path.join(scratch, 'output');
    const workspacesRoot = path.join(scratch, 'workspaces');
    await Promise.all([
        fs.mkdir(outputDirectory, { recursive: true }),
        fs.mkdir(workspacesRoot, { recursive: true }),
    ]);
    return {
        repoRoot,
        outputDirectory,
        workspacesRoot,
        scenario: createScenario(),
        attempt: 1,
        candidateCommit: 'candidate',
        model,
        through: 'scaffold',
        executor: { run: async () => completedRun() },
        projectValidator: {
            validate: async () => ({ outcome: 'passed', commands: [] }),
        },
        localRuntimeValidator: {
            validate: async () => {
                throw new Error('Local validation was not expected.');
            },
        },
        ...overrides,
    };
}

function completedRun(): CorAgentRunResult {
    return {
        outcome: 'completed',
        startedAt: '2026-08-07T00:00:00.000Z',
        completedAt: '2026-08-07T00:00:01.000Z',
        durationMs: 1_000,
        usage: {
            apiCalls: 1,
            inputTokens: 1,
            outputTokens: 1,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            totalNanoAiu: 0,
            models: [model],
        },
        toolCalls: [],
        errors: [],
    };
}

async function withScratch(operation: (scratch: string) => Promise<void>): Promise<void> {
    await fs.mkdir(resultsRoot, { recursive: true });
    const scratch = await fs.mkdtemp(path.join(resultsRoot, 'baseline-merit-parity-'));
    try {
        await operation(scratch);
    } finally {
        await fs.rm(scratch, { recursive: true, force: true });
    }
}
