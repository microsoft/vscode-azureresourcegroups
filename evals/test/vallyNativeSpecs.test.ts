/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-floating-promises -- node:test registrations are intentionally top-level. */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
    loadEvalSpec,
    loadExperimentConfig,
    resolveExperiment,
    resolveStimulus,
} from '@microsoft/vally';
import { loadScenarios } from '../src/scenario';
import {
    checkedInGenerationOptions,
    COR_EVAL_MODELS,
    createNativeSpecs,
    NEUTRAL_EXPERIMENT_PROMPT,
    writeNativeSpecs,
} from '../vally/native/generate';

const nativeRoot = path.resolve('evals/vally/native');
const scenarioRoot = path.resolve('evals/scenarios');

describe('Vally-native generated eval and experiment definitions', () => {
    test('generates deterministically and has no checked-in drift', async () => {
        const first = await createNativeSpecs(checkedInGenerationOptions);
        const second = await createNativeSpecs(checkedInGenerationOptions);
        assert.deepEqual([...first], [...second]);
        await writeNativeSpecs(checkedInGenerationOptions, true);
    });

    test('covers all scenarios with canonical local trial identity', async () => {
        const scenarios = await loadScenarios(scenarioRoot);
        const spec = await loadEvalSpec(path.join(nativeRoot, 'authoritative.eval.yaml'));
        const expected = scenarios.map(scenario => scenario.id).sort();
        assert.equal(spec.defaults.executor, 'cor-aca');
        assert.equal(spec.defaults.timeout, '60m');
        assert.equal(spec.stimuli.length, 20);
        assert.deepEqual(spec.stimuli.map(stimulus => stimulus.name).sort(), expected);
        assert.equal(new Set(spec.stimuli.map(stimulus => stimulus.name)).size, 20);

        for (const scenario of scenarios) {
            const stimulus = spec.stimuli.find(candidate => candidate.name === scenario.id);
            assert.ok(stimulus);
            assert.equal(stimulus.prompt, scenario.prompt);
            assert.equal(stimulus.tags?.scenarioId, scenario.id);
            assert.equal(stimulus.tags?.arm, 'rails');
            assert.equal(stimulus.tags?.endpoint, 'local');
            assert.equal(stimulus.tags?.model, checkedInGenerationOptions.defaultModel);
            assert.equal(stimulus.supported_executors?.[0], 'cor-aca');
            assert.equal(stimulus.constraints?.max_duration, undefined);
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

            const env = typeof stimulus.environment === 'object'
                ? stimulus.environment.env
                : undefined;
            assert.equal(env?.COR_EVAL_SCENARIO_ID, scenario.id);
            assert.equal(env?.COR_EVAL_MODEL, checkedInGenerationOptions.defaultModel);
            assert.equal(env?.COR_EVAL_ARM, 'rails');
            assert.equal(env?.COR_EVAL_ENDPOINT, 'local');
            assert.equal(env?.COR_SCENARIO_ID, undefined);
            assert.equal(env?.COR_MODEL, undefined);
            assert.equal(env?.COR_ARM, undefined);
            assert.equal(env?.COR_ENDPOINT, undefined);

            const authoritative = stimulus.graders?.find(grader => grader.type === 'cor-authoritative');
            assert.ok(authoritative);
            assert.equal(authoritative.config?.evidenceTier, 'ordinary');
            assert.ok(Array.isArray(authoritative.config?.requiredGates));
            assert.equal(authoritative.config.requiredGates.includes('deployment'), false);
            assert.equal(spec.scoring?.threshold, 1);
            assert.equal(spec.scoring?.weights?.['cor-authoritative'], 1);
            assert.equal(spec.scoring?.weights?.['custom-metrics'], 0);
        }
    });

    test('defines mock-plannable same-model Rails and baseline experiment sets', async () => {
        const sets = [
            ['compatibility-pilot', 2, 1],
            ['representative', 4, 2],
            ['release', 20, 3],
        ] as const;
        const seenModels = new Set<string>();

        for (const [set, scenarioCount, runs] of sets) {
            const experimentEval = await loadEvalSpec(
                path.join(nativeRoot, `experiment-${set}.eval.yaml`),
            );
            assert.equal(experimentEval.defaults.executor, 'mock');
            assert.equal(experimentEval.defaults.timeout, '60m');
            assert.equal(experimentEval.stimuli.length, scenarioCount);
            assert.ok(experimentEval.stimuli.every(
                stimulus => stimulus.prompt === NEUTRAL_EXPERIMENT_PROMPT,
            ));
            for (const stimulus of experimentEval.stimuli) {
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
            assert.deepEqual(experimentEval.scoring?.weights, { 'custom-metrics': 1 });

            for (const model of COR_EVAL_MODELS) {
                const fileModel = model.replaceAll('.', '-');
                const config = await loadExperimentConfig(
                    path.join(nativeRoot, 'experiments', `${set}-${fileModel}.experiment.yaml`),
                );
                seenModels.add(config.overrides?.model ?? '');
                assert.equal(config.overrides?.executor, 'mock');
                assert.equal(config.overrides?.model, model);
                assert.equal(config.overrides?.runs, runs);
                assert.equal(config.overrides?.timeout, '60m');
                assert.deepEqual(Object.keys(config.variants).sort(), ['baseline', 'rails']);
                assert.equal(config.baseline, 'baseline');
                assert.equal(config.variants.rails.overrides?.model, model);
                assert.equal(config.variants.baseline.overrides?.model, model);
                assert.equal(config.variants.rails.overrides?.executor, 'mock');
                assert.equal(config.variants.baseline.overrides?.executor, 'mock');
                assert.equal(config.variants.rails.environment?.env?.COR_EVAL_ARM, 'rails');
                assert.equal(
                    config.variants.baseline.environment?.env?.COR_EVAL_ARM,
                    'baseline-controlled',
                );
                assert.equal(config.variants.rails.environment?.env?.COR_EVAL_MODEL, model);
                assert.equal(config.variants.baseline.environment?.env?.COR_EVAL_MODEL, model);
                assert.deepEqual(config.vary, ['/environment/env/COR_EVAL_ARM']);
            }
        }
        assert.deepEqual(seenModels, new Set(COR_EVAL_MODELS));
    });

    test('resolves non-default experiment model and arm env before execution', async () => {
        const model = 'claude-sonnet-5';
        const resolved = await resolveExperiment(path.join(
            nativeRoot,
            'experiments',
            `compatibility-pilot-${model}.experiment.yaml`,
        ));
        assert.deepEqual(resolved.variantNames, ['rails', 'baseline']);
        for (const plan of resolved.plans) {
            const rootEnvironment = typeof plan.effectiveSpec.environment === 'object'
                ? plan.effectiveSpec.environment
                : undefined;
            const stimulus = resolveStimulus(plan.effectiveSpec.stimuli[0], rootEnvironment, {});
            assert.equal(stimulus.environment?.env?.COR_EVAL_MODEL, model);
            assert.equal(
                stimulus.environment?.env?.COR_EVAL_ARM,
                plan.variant === 'rails' ? 'rails' : 'baseline-controlled',
            );
            assert.equal(stimulus.environment?.env?.COR_EVAL_ENDPOINT, 'local');
        }
    });

    test('rejects auto models and accidental model-set drift', async () => {
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

    test('keeps qualitative prompt and panel grading supplemental and local', async () => {
        const qualitative = await loadEvalSpec(path.join(nativeRoot, 'qualitative.eval.yaml'));
        assert.equal(qualitative.tags?.authority, 'supplemental-uncalibrated');
        assert.equal(qualitative.defaults.timeout, '60m');
        assert.equal(qualitative.stimuli.length, 20);
        for (const stimulus of qualitative.stimuli) {
            assert.equal(stimulus.tags?.endpoint, 'local');
            assert.deepEqual(stimulus.graders?.map(grader => grader.type), ['prompt', 'panel']);
            for (const grader of stimulus.graders ?? []) {
                assert.deepEqual(grader.config?.evidence, ['trajectory', 'diff']);
                assert.match(String(grader.config?.prompt), /satisfied user/i);
                assert.match(String(grader.config?.prompt), /ordinary local trial/i);
            }
        }
    });
});
