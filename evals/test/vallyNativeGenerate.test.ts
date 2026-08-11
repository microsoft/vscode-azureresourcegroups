/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-floating-promises -- node:test registrations are intentionally top-level. */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
    createDefaultGraderRegistry,
    createExecutorRegistry,
    loadEvalSpec,
    loadExperimentConfig,
    planRun,
    ProjectContext,
    resolveExperiment,
    resolveStimulus,
} from '@microsoft/vally';
import { MockExecutor } from '@microsoft/vally/executor/mock';
import { loadScenarios } from '../src/scenario';
import {
    checkedInGenerationOptions,
    COR_EVAL_MODELS,
    createNativeSpecs,
    NEUTRAL_EXPERIMENT_PROMPT,
    requiredGatesForScenario,
    writeNativeSpecs,
} from '../vally/native/generate';

const nativeRoot = path.resolve('evals/vally/native');
const scenarioRoot = path.resolve('evals/scenarios');

describe('Vally-native generation', () => {
    test('is deterministic and checked in without drift', async () => {
        const first = await createNativeSpecs(checkedInGenerationOptions);
        const second = await createNativeSpecs(checkedInGenerationOptions);
        assert.deepEqual([...first], [...second]);
        await writeNativeSpecs(checkedInGenerationOptions, true);
    });

    test('uses canonical trial identity and an ordinary local evidence tier', async () => {
        const spec = await loadEvalSpec(path.join(nativeRoot, 'authoritative.eval.yaml'));
        assert.equal(spec.defaults.timeout, '60m');
        assert.equal(spec.defaults.executor, 'cor-aca');
        assert.equal(spec.stimuli.length, 20);
        for (const stimulus of spec.stimuli) {
            const env = typeof stimulus.environment === 'object'
                ? stimulus.environment.env
                : undefined;
            assert.equal(env?.COR_EVAL_SCENARIO_ID, stimulus.name);
            assert.equal(env?.COR_EVAL_ARM, 'rails');
            assert.equal(env?.COR_EVAL_ENDPOINT, 'local');
            assert.equal(env?.COR_EVAL_MODEL, checkedInGenerationOptions.defaultModel);
            assert.equal(stimulus.tags?.scenarioId, stimulus.name);
            assert.equal(stimulus.tags?.arm, 'rails');
            assert.equal(stimulus.tags?.endpoint, 'local');
            assert.equal(stimulus.tags?.model, checkedInGenerationOptions.defaultModel);
            assert.equal(stimulus.constraints?.max_duration, undefined);
            assert.equal(env?.COR_SCENARIO_ID, undefined);
            assert.equal(env?.COR_ARM, undefined);
            assert.equal(env?.COR_ENDPOINT, undefined);
            assert.equal(env?.COR_MODEL, undefined);
            assert.deepEqual(stimulus.artifacts?.include, [
                'cor-validation.json',
                'custom_metrics.json',
                'trajectory.json',
                'workspace.diff',
                'validation-manifest.json',
                'native-summary.json',
                'run-result.json',
                'adapter-metrics.json',
                'reports/**',
            ]);

            const grader = stimulus.graders?.find(candidate => candidate.type === 'cor-authoritative');
            assert.ok(grader);
            assert.equal(grader.config?.evidenceTier, 'ordinary');
            const gates = grader.config?.requiredGates;
            assert.ok(Array.isArray(gates));
            assert.equal(gates.includes('deployment'), false);
        }
    });

    test('makes gates endpoint/scenario aware and deployment opt-in', async () => {
        const scenarios = await loadScenarios(scenarioRoot);
        const scenario = scenarios.find(candidate => candidate.id === 'crud-react-functions-postgres');
        assert.ok(scenario);
        const plan = requiredGatesForScenario(scenario, 'plan');
        assert.deepEqual(plan, [
            'planning',
            'model',
            'provenance',
        ]);
        const scaffold = requiredGatesForScenario(scenario, 'scaffold');
        assert.equal(scaffold.includes('scaffold'), true);
        assert.equal(scaffold.includes('build'), true);
        assert.equal(scaffold.includes('test'), true);
        assert.equal(scaffold.includes('integration'), false);
        assert.equal(scaffold.includes('local-runtime'), false);
        const local = requiredGatesForScenario(scenario, 'local');
        assert.equal(local.includes('integration'), true);
        assert.equal(local.includes('local-runtime'), true);
        assert.equal(local.includes('deployment'), false);
        assert.equal(
            requiredGatesForScenario(scenario, 'local', 'deployment-authorized').includes('deployment'),
            true,
        );
    });

    test('generates mock-plannable neutral experiment sets for the deliberate models', async () => {
        const sets = [
            ['compatibility-pilot', 2, 1],
            ['representative', 4, 2],
            ['release', 20, 3],
        ] as const;
        for (const [set, scenarioCount, runs] of sets) {
            const evalSpec = await loadEvalSpec(path.join(nativeRoot, `experiment-${set}.eval.yaml`));
            assert.equal(evalSpec.defaults.executor, 'mock');
            assert.equal(evalSpec.defaults.timeout, '60m');
            assert.equal(evalSpec.stimuli.length, scenarioCount);
            assert.ok(evalSpec.stimuli.every(stimulus => stimulus.prompt === NEUTRAL_EXPERIMENT_PROMPT));
            for (const stimulus of evalSpec.stimuli) {
                assert.ok(stimulus.artifacts?.include.includes('validation-manifest.json'));
                assert.ok(stimulus.artifacts?.include.includes('native-summary.json'));
                assert.ok(stimulus.artifacts?.include.includes('run-result.json'));
                assert.ok(stimulus.artifacts?.include.includes('adapter-metrics.json'));
                assert.equal(stimulus.tags?.backendAuthoritative, 'true');
                assert.equal(stimulus.tags?.['applicability-planning'], 'not-applicable');
                assert.deepEqual(stimulus.graders?.map(grader => grader.type), ['custom-metrics']);
                assert.equal(
                    stimulus.graders?.some(grader => grader.type === 'cor-authoritative'),
                    false,
                );
            }
            assert.deepEqual(evalSpec.scoring?.weights, { 'custom-metrics': 1 });

            for (const model of COR_EVAL_MODELS) {
                const experiment = await loadExperimentConfig(path.join(
                    nativeRoot,
                    'experiments',
                    `${set}-${model.replaceAll('.', '-')}.experiment.yaml`,
                ));
                assert.equal(experiment.overrides?.executor, 'mock');
                assert.equal(experiment.overrides?.model, model);
                assert.equal(experiment.overrides?.runs, runs);
                assert.deepEqual(Object.keys(experiment.variants).sort(), ['baseline', 'rails']);
                assert.equal(experiment.variants.rails.overrides?.model, model);
                assert.equal(experiment.variants.baseline.overrides?.model, model);
                assert.equal(experiment.variants.rails.environment?.env?.COR_EVAL_ARM, 'rails');
                assert.equal(
                    experiment.variants.baseline.environment?.env?.COR_EVAL_ARM,
                    'baseline-controlled',
                );
                assert.equal(experiment.variants.rails.environment?.env?.COR_EVAL_MODEL, model);
                assert.equal(experiment.variants.baseline.environment?.env?.COR_EVAL_MODEL, model);
                assert.deepEqual(experiment.vary, ['/environment/env/COR_EVAL_ARM']);
            }
        }
    });

    test('Vally dry-run resolution applies non-default model and arm overrides', async () => {
        for (const model of ['claude-sonnet-5', 'gpt-5.4-mini'] as const) {
            const resolved = await resolveExperiment(path.join(
                nativeRoot,
                'experiments',
                `compatibility-pilot-${model.replaceAll('.', '-')}.experiment.yaml`,
            ));
            for (const plan of resolved.plans) {
                const rootEnvironment = typeof plan.effectiveSpec.environment === 'object'
                    ? plan.effectiveSpec.environment
                    : undefined;
                const stimulus = resolveStimulus(
                    plan.effectiveSpec.stimuli[0],
                    rootEnvironment,
                    {},
                );
                assert.equal(stimulus.environment?.env?.COR_EVAL_MODEL, model);
                assert.equal(
                    stimulus.environment?.env?.COR_EVAL_ARM,
                    plan.variant === 'rails' ? 'rails' : 'baseline-controlled',
                );
                assert.equal(stimulus.environment?.env?.COR_EVAL_ENDPOINT, 'local');
                assert.equal(
                    stimulus.environment?.env?.COR_EVAL_SCENARIO_ID,
                    'api-ts-functions-minimal',
                );
            }
        }
    });

    test('default Vally planning produces all compatibility variant work items', async () => {
        const model = 'gpt-5.6-sol';
        const resolved = await resolveExperiment(path.join(
            nativeRoot,
            'experiments',
            'compatibility-pilot-gpt-5-6-sol.experiment.yaml',
        ));
        const rails = resolved.plans.find(plan => plan.variant === 'rails');
        const baseline = resolved.plans.find(plan => plan.variant === 'baseline');
        assert.ok(rails);
        assert.ok(baseline);

        const executorRegistry = createExecutorRegistry();
        executorRegistry.register(new MockExecutor());
        const mock = executorRegistry.get('mock');
        assert.ok(mock);
        const plan = await planRun({
            variants: [
                {
                    name: 'rails',
                    specs: [{ filePath: rails.evalFile, spec: rails.effectiveSpec }],
                },
                {
                    name: 'baseline',
                    specs: [{ filePath: baseline.evalFile, spec: baseline.effectiveSpec }],
                },
            ],
            projectCtx: await ProjectContext.load(path.resolve('.')),
            getExecutor: () => mock,
            models: [undefined],
            graderRegistry: createDefaultGraderRegistry(),
        });

        assert.equal(plan.totalItems, 4);
        assert.equal(plan.items.length, 4);
        assert.deepEqual(new Set(plan.items.map(item => item.variant)), new Set(['rails', 'baseline']));
        assert.ok(plan.items.every(item => item.model === model));
        assert.ok(plan.items.every(
            item => item.stimulus.environment?.env?.COR_EVAL_MODEL === model,
        ));
        assert.ok(plan.items.every(item =>
            item.stimulus.environment?.env?.COR_EVAL_ARM
            === (item.variant === 'rails' ? 'rails' : 'baseline-controlled')));
        const unknownGraderDiagnostics = plan.diagnostics.filter(diagnostic =>
            /unknown.grader|grader.type/i.test(`${diagnostic.code} ${diagnostic.message}`));
        assert.deepEqual(unknownGraderDiagnostics, []);
    });

    test('rejects auto and accidental model-set changes', async () => {
        await assert.rejects(
            createNativeSpecs({
                ...checkedInGenerationOptions,
                defaultModel: 'auto',
            } as unknown as typeof checkedInGenerationOptions),
            /supplied explicitly/,
        );
        await assert.rejects(
            createNativeSpecs({
                ...checkedInGenerationOptions,
                models: ['gpt-5.6-sol', 'claude-sonnet-5', 'gpt-5.6-sol'],
            }),
            /deliberate ordered set/,
        );
    });
});
