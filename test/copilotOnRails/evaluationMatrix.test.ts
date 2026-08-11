/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import {
    MatrixOptions,
    createMatrixManifest,
    createModelDirectoryMap,
    matrixPairingKey,
    parseMatrixArgs,
    sanitizeModelDirectory,
    validateMatrixScenarios,
} from '../../evals/src/matrix';
import {
    EvaluationAttempt,
    EvaluationSummary,
    createReport,
    renderMarkdown,
} from '../../evals/src/report';
import { CorEvaluationScenario } from '../../evals/src/scenario';

suite('Evaluation model matrix', () => {
    test('parses repeated and comma-separated lists with bounded numeric options', () => {
        const options = parseMatrixArgs([
            '--models', 'model-a,model-b',
            '--models=model-c',
            '--scenarios', 'scenario-a',
            '--scenarios=scenario-b,scenario-c',
            '--attempts', '3',
            '--through', 'local',
            '--concurrency', '4',
            '--seed', 'stable-seed',
            '--output', 'matrix-output',
            '--dry-run',
        ]);
        assert.deepEqual(options.models, ['model-a', 'model-b', 'model-c']);
        assert.deepEqual(options.scenarioIds, ['scenario-a', 'scenario-b', 'scenario-c']);
        assert.equal(options.attempts, 3);
        assert.equal(options.through, 'local');
        assert.equal(options.concurrency, 4);
        assert.equal(options.seed, 'stable-seed');
        assert.equal(options.dryRun, true);

        assert.throws(
            () => parseMatrixArgs(['--models', 'model-a,model-a', '--scenarios', 'scenario-a']),
            /Duplicate --models value/,
        );
        assert.throws(
            () => parseMatrixArgs(['--models', 'model-a,', '--scenarios', 'scenario-a']),
            /--models values must be non-empty/,
        );
        assert.throws(
            () => parseMatrixArgs(['--models', 'model-a', '--scenarios', 'scenario-a', '--attempts', '51']),
            /--attempts must be an integer from 1 to 50/,
        );
        assert.throws(
            () => parseMatrixArgs(['--models', 'model-a', '--scenarios', 'scenario-a', '--concurrency', '0']),
            /--concurrency must be an integer from 1 to 10/,
        );
        assert.throws(
            () => parseMatrixArgs(['--models', 'model-a', '--scenarios', 'scenario-a', '--seed=']),
            /--seed must be a non-empty deterministic seed/,
        );
        assert.throws(
            () => validateMatrixScenarios(['unknown'], [scenario('scenario-a')]),
            /Unknown scenario: unknown/,
        );
    });

    test('creates a deterministic paired and arm-balanced dry manifest', () => {
        const options = matrixOptions();
        const first = createMatrixManifest(options);
        const second = createMatrixManifest({ ...options });
        assert.deepEqual(first, second);
        assert.equal(first.dryRun, true);
        assert.equal(first.pairing, 'model+scenarioId+attempt');
        assert.equal(first.schedule.length, 16);
        assert.equal('generatedAt' in first, false);
        for (let index = 0; index < first.schedule.length; index += 2) {
            const pair = first.schedule.slice(index, index + 2);
            assert.equal(pair[0].pairingKey, pair[1].pairingKey);
            assert.deepEqual(new Set(pair.map(job => job.arm)), new Set(['rails', 'baseline-controlled']));
        }
        assert.notDeepEqual(
            first.schedule,
            createMatrixManifest({ ...options, seed: 'different-seed' }).schedule,
        );
    });

    test('uses model-aware pairing keys and rejects directory collisions', () => {
        assert.notEqual(
            matrixPairingKey('model-a', 'scenario', 1),
            matrixPairingKey('model-b', 'scenario', 1),
        );
        assert.equal(sanitizeModelDirectory(' Vendor/Model: Preview '), 'vendor-model-preview');
        assert.equal(sanitizeModelDirectory('CON'), 'model-con');
        assert.throws(() => createModelDirectoryMap(['model-a', 'model-a']), /Duplicate model id/);
        assert.throws(
            () => createModelDirectoryMap(['Vendor/Model', 'vendor:model']),
            /collide in directory name "vendor-model"/,
        );
        assert.throws(
            () => createModelDirectoryMap(['///']),
            /cannot be converted to a safe directory name/,
        );
    });

    test('reports unpaired model and model-by-scenario outcomes', () => {
        const summaries = [
            candidateSummary('model-a', [
                attempt('a-1', 'scenario-a', 1, 'model-a', 'autonomous_success'),
                attempt('a-2', 'scenario-b', 1, 'model-a', 'failed'),
            ]),
            candidateSummary('model-b', [
                attempt('b-1', 'scenario-a', 1, 'model-b', 'autonomous_success', 1),
            ]),
        ];
        const report = createReport(summaries, [scenario('scenario-a'), scenario('scenario-b')], []);
        assert.deepEqual(report.byModel.map(value => value.model), ['model-a', 'model-b']);
        assert.equal(report.byModel[0].autonomousOutcome.attempts, 2);
        assert.equal(report.byModel[0].autonomousOutcome.successes, 1);
        assert.equal(report.byModel[1].firstPassOutcome.successes, 0);
        assert.equal(report.byModel[1].recoveredSuccesses, 1);
        assert.deepEqual(
            report.byModelScenario.map(value => `${value.model}/${value.scenarioId}`),
            ['model-a/scenario-a', 'model-a/scenario-b', 'model-b/scenario-a'],
        );
        assert.match(renderMarkdown(report), /## By Model and Scenario/);
    });

    test('creates per-model paired metrics and rejects model mismatch or missing evidence', () => {
        const candidate = [
            candidateSummary('model-a', [
                attempt('candidate-a', 'scenario-a', 1, 'model-a', 'autonomous_success'),
            ]),
            candidateSummary('model-b', [
                attempt('candidate-b', 'scenario-a', 1, 'model-b', 'failed'),
            ]),
        ];
        const baseline = [
            baselineSummary('model-a', [
                attempt('baseline-a', 'scenario-a', 1, 'model-a', 'failed', 0, 'baseline-controlled'),
            ]),
            baselineSummary('model-b', [
                attempt('baseline-b', 'scenario-a', 1, 'model-b', 'autonomous_success', 0, 'baseline-controlled'),
            ]),
        ];
        const report = createReport(candidate, [scenario('scenario-a')], baseline);
        assert.deepEqual(report.baselineComparison?.byModel.map(value => value.model), ['model-a', 'model-b']);
        assert.equal(report.baselineComparison?.byModel[0].allAutonomous.railsOnlyWins, 1);
        assert.equal(report.baselineComparison?.byModel[1].allAutonomous.baselineOnlyWins, 1);
        assert.match(renderMarkdown(report), /### Matched comparison by model/);

        assert.throws(
            () => createReport(
                [candidate[0]],
                [scenario('scenario-a')],
                [baselineSummary('model-b', [
                    attempt(
                        'mismatch',
                        'scenario-a',
                        1,
                        'model-b',
                        'autonomous_success',
                        0,
                        'baseline-controlled',
                    ),
                ])],
            ),
            /requested different models/,
        );
        const missingObserved = {
            ...candidate[0],
            results: [{ ...candidate[0].results[0], observedModels: undefined }],
        };
        assert.throws(
            () => createReport([missingObserved], [scenario('scenario-a')], [baseline[0]]),
            /missing observed-model evidence under declared arm "rails"/,
        );
    });
});

function matrixOptions(): MatrixOptions {
    return {
        models: ['model-a', 'model-b'],
        scenarioIds: ['scenario-a', 'scenario-b'],
        attempts: 2,
        through: 'scaffold',
        concurrency: 2,
        seed: 'stable-seed',
        outputDirectory: 'ignored-by-manifest',
        dryRun: true,
    };
}

function scenario(id: string): CorEvaluationScenario {
    return {
        schemaVersion: '1',
        id,
        prompt: 'Create an API.',
        baselinePrompt: 'Build a complete standalone API with source code, configuration, automated tests, local debugging support, and deployment-ready infrastructure.',
        tags: { archetype: 'api' },
        validation: {
            profile: 'minimal',
            build: true,
            test: true,
            lint: 'required',
            timeoutMinutes: 5,
        },
    };
}

function attempt(
    runId: string,
    scenarioId: string,
    attemptNumber: number,
    model: string,
    outcome: EvaluationAttempt['outcome'],
    agentRetries = 0,
    evaluationArm: NonNullable<EvaluationAttempt['evaluationArm']> = 'rails',
): EvaluationAttempt {
    return {
        evaluationArm,
        runId,
        scenarioId,
        attempt: attemptNumber,
        outcome,
        failureCategory: outcome === 'failed' ? 'product_failure' : undefined,
        model,
        requestedModel: model,
        observedModels: [model],
        durationMs: 100,
        agentRetries,
        stages: [{
            name: 'scaffold',
            agentRun: {
                outcome: 'completed',
                usage: {
                    inputTokens: 10,
                    outputTokens: 5,
                    models: [model],
                },
            },
        }],
    };
}

function candidateSummary(model: string, results: EvaluationAttempt[]): EvaluationSummary {
    return {
        candidateCommit: 'candidate',
        agentAssetsHash: 'assets',
        through: 'scaffold',
        evaluationArm: 'rails',
        requestedModels: [model],
        observedModels: [model],
        results,
    };
}

function baselineSummary(model: string, results: EvaluationAttempt[]): EvaluationSummary {
    return {
        candidateCommit: 'candidate',
        agentAssetsHash: 'not-applicable:baseline-controlled',
        through: 'scaffold',
        evaluationArm: 'baseline-controlled',
        requestedModel: model,
        observedModels: [model],
        results,
    };
}
