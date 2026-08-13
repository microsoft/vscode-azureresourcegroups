/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { loadScenarios, type CorEvaluationScenario } from '../../src/scenario';

/* eslint-disable @typescript-eslint/naming-convention -- generated keys intentionally match Vally and executor schemas. */

export const COR_EVAL_MODELS = [
    'gpt-5.6-sol',
    'claude-sonnet-5',
    'gpt-5.4-mini',
] as const;

export const NEUTRAL_EXPERIMENT_PROMPT =
    'Execute the selected Copilot on Rails scenario using the explicitly configured arm, endpoint, and model.';

const scenarioDirectory = path.resolve('evals/scenarios');
const outputDirectory = path.resolve('evals/vally/native');
const compatibilityPilotScenarioIds = [
    'api-ts-functions-minimal',
    'crud-react-functions-postgres',
] as const;
const representativeScenarioIds = [
    'api-ts-functions-minimal',
    'crud-react-functions-postgres',
    'multiservice-react-functions-worker-postgres-queue',
    'worker-python-functions-blob',
] as const;

type CorEvalModel = typeof COR_EVAL_MODELS[number];
type CorEvalEndpoint = 'plan' | 'scaffold' | 'local';
type EvidenceTier = 'ordinary' | 'deployment-authorized';

export interface NativeGenerationOptions {
    defaultModel: CorEvalModel;
    models: [CorEvalModel, CorEvalModel, CorEvalModel];
    qualitativeJudgeModels: [CorEvalModel, CorEvalModel, CorEvalModel];
}

export const checkedInGenerationOptions: NativeGenerationOptions = {
    defaultModel: 'gpt-5.6-sol',
    models: [...COR_EVAL_MODELS],
    qualitativeJudgeModels: [...COR_EVAL_MODELS],
};

export async function createNativeSpecs(
    options: NativeGenerationOptions,
    suppliedScenarios?: CorEvaluationScenario[],
): Promise<Map<string, string>> {
    validateOptions(options);
    const scenarios = suppliedScenarios ?? await loadScenarios(scenarioDirectory);
    if (scenarios.length !== 20) {
        throw new Error(`Expected exactly 20 Copilot on Rails scenarios; found ${scenarios.length}.`);
    }
    const scenarioById = new Map(scenarios.map(scenario => [scenario.id, scenario]));
    const pilot = compatibilityPilotScenarioIds.map(id => requiredScenario(scenarioById, id));
    const representative = representativeScenarioIds.map(id => requiredScenario(scenarioById, id));
    const sorted = [...scenarios].sort((left, right) => left.id.localeCompare(right.id));
    const specs = new Map<string, string>();

    specs.set('authoritative.eval.yaml', yaml(createAuthoritativeEval(
        sorted,
        options.defaultModel,
        'copilot-on-rails-authoritative',
        'cor-aca',
        false,
    )));
    specs.set('representative.eval.yaml', yaml(createAuthoritativeEval(
        representative,
        options.defaultModel,
        'copilot-on-rails-representative',
        'cor-aca',
        false,
    )));
    specs.set('canary.eval.yaml', yaml(createAuthoritativeEval(
        pilot,
        options.defaultModel,
        'copilot-on-rails-compatibility-canary',
        'cor-aca',
        false,
    )));
    specs.set('qualitative.eval.yaml', yaml(createQualitativeEval(
        sorted,
        options.defaultModel,
        options.qualitativeJudgeModels,
    )));
    specs.set('fixtures/oracle.eval.yaml', yaml(createOracleEval()));
    specs.set('fixtures/oracle-custom-metrics.json', `${JSON.stringify({
        schema: 'copilot-on-rails-authoritative-metrics/v1',
        schemaVersion: 1,
        values: { authoritative_hard_gates_passed: true },
    }, undefined, 2)}\n`);

    const experimentSets = [
        {
            id: 'compatibility-pilot',
            name: 'copilot-on-rails-compatibility-pilot',
            scenarios: pilot,
            runs: 1,
        },
        {
            id: 'representative',
            name: 'copilot-on-rails-representative-experiment',
            scenarios: representative,
            runs: 2,
        },
        {
            id: 'release',
            name: 'copilot-on-rails-release-experiment',
            scenarios: sorted,
            runs: 3,
        },
    ] as const;

    for (const set of experimentSets) {
        const evalPath = `experiment-${set.id}.eval.yaml`;
        specs.set(evalPath, yaml(createAuthoritativeEval(
            set.scenarios,
            options.defaultModel,
            set.name,
            'mock',
            true,
        )));
        for (const model of options.models) {
            specs.set(
                `experiments/${set.id}-${fileSafeModel(model)}.experiment.yaml`,
                yaml(createExperiment({
                    name: `${set.name}-${fileSafeModel(model)}`,
                    evalFile: `../${evalPath}`,
                    model,
                    runs: set.runs,
                })),
            );
        }
    }
    return specs;
}

export async function writeNativeSpecs(
    options: NativeGenerationOptions,
    check = false,
): Promise<void> {
    const specs = await createNativeSpecs(options);
    const expectedPaths = new Set([...specs.keys()].map(relativePath => path.join(outputDirectory, relativePath)));
    const currentGeneratedFiles = await listGeneratedFiles(outputDirectory);
    const drift: string[] = [];

    for (const [relativePath, content] of specs) {
        const target = path.join(outputDirectory, relativePath);
        if (check) {
            const current = await fs.readFile(target, 'utf8').catch(() => undefined);
            if (current !== content) {
                drift.push(relativePath);
            }
        } else {
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, content);
        }
    }

    for (const currentPath of currentGeneratedFiles) {
        if (!expectedPaths.has(currentPath) && isGeneratedSpec(currentPath)) {
            if (check) {
                drift.push(path.relative(outputDirectory, currentPath));
            } else {
                await fs.rm(currentPath);
            }
        }
    }
    if (drift.length > 0) {
        throw new Error(`Generated Vally-native specs are stale: ${drift.sort().join(', ')}`);
    }
}

function createAuthoritativeEval(
    scenarios: readonly CorEvaluationScenario[],
    model: CorEvalModel,
    name: string,
    executor: 'cor-aca' | 'mock',
    neutralStimulus: boolean,
): Record<string, unknown> {
    return {
        name,
        description: neutralStimulus
            ? 'Backend-owned Copilot on Rails experiment plan with neutral stimuli.'
            : 'Direct Copilot on Rails execution with fail-closed authoritative artifact grading.',
        version: '1',
        type: 'capability',
        tags: {
            component: 'copilot-on-rails',
            plane: 'vally-native',
            authority: 'local-authoritative-hard-gate',
            evidenceTier: 'ordinary',
        },
        defaults: {
            runs: 1,
            timeout: '60m',
            model,
            executor,
        },
        ...(neutralStimulus
            ? {
                environment: {
                    env: {
                        COR_EVAL_MODEL: model,
                        COR_EVAL_ARM: 'rails',
                        COR_EVAL_ENDPOINT: 'local',
                    },
                },
            }
            : {}),
        stimuli: scenarios.map(scenario => createAuthoritativeStimulus(
            scenario,
            model,
            executor,
            neutralStimulus,
        )),
        scoring: {
            weights: neutralStimulus
                ? { 'custom-metrics': 1 }
                : {
                    'cor-authoritative': 1,
                    'custom-metrics': 0,
                },
            threshold: 1,
        },
    };
}

function createAuthoritativeStimulus(
    scenario: CorEvaluationScenario,
    model: CorEvalModel,
    executor: 'cor-aca' | 'mock',
    neutralStimulus: boolean,
): Record<string, unknown> {
    const endpoint: CorEvalEndpoint = 'local';
    const requiredGates = requiredGatesForScenario(scenario, endpoint)
        .filter(gate => !neutralStimulus || gate !== 'planning');
    const applicability = Object.fromEntries(allGates().map(gate => [
        `applicability-${gate}`,
        requiredGates.includes(gate) ? 'required' : 'not-applicable',
    ]));
    return {
        name: scenario.id,
        prompt: neutralStimulus ? NEUTRAL_EXPERIMENT_PROMPT : scenario.prompt,
        tags: {
            ...scenario.tags,
            scenarioId: scenario.id,
            endpoint,
            ...(!neutralStimulus ? { arm: 'rails', model } : {}),
            ...(neutralStimulus ? { backendAuthoritative: 'true' } : {}),
            profile: scenario.validation.profile,
            validationCommandTimeoutMinutes: String(scenario.validation.timeoutMinutes),
            ...applicability,
        },
        environment: {
            env: {
                COR_EVAL_SCENARIO_ID: scenario.id,
                ...(!neutralStimulus
                    ? {
                        COR_EVAL_MODEL: model,
                        COR_EVAL_ARM: 'rails',
                        COR_EVAL_ENDPOINT: endpoint,
                    }
                    : {}),
            },
        },
        ...(executor === 'cor-aca' ? { supported_executors: ['cor-aca'] } : {}),
        artifacts: {
            include: [
                'cor-validation.json',
                'custom_metrics.json',
                'trajectory.json',
                'workspace.diff',
                'validation-manifest.json',
                'native-summary.json',
                'run-result.json',
                'adapter-metrics.json',
                'reports/**',
            ],
            exclude: ['**/*.secret', '**/.env*'],
        },
        graders: neutralStimulus
            ? [{
                type: 'custom-metrics',
                name: 'backend-authoritative-metric',
                config: {
                    path: 'custom_metrics.json',
                    assertions: [{ metric: 'authoritative_hard_gates_passed', equals: true }],
                },
            }]
            : [
                {
                    type: 'cor-authoritative',
                    name: 'authoritative-local-hard-gates',
                    config: {
                        validationPath: 'cor-validation.json',
                        metricsPath: 'custom_metrics.json',
                        requiredGates,
                        evidenceTier: 'ordinary',
                    },
                },
                {
                    type: 'custom-metrics',
                    name: 'authoritative-metric',
                    config: {
                        path: 'custom_metrics.json',
                        assertions: [{ metric: 'authoritative_hard_gates_passed', equals: true }],
                    },
                },
            ],
    };
}

function createQualitativeEval(
    scenarios: readonly CorEvaluationScenario[],
    model: CorEvalModel,
    judges: [CorEvalModel, CorEvalModel, CorEvalModel],
): Record<string, unknown> {
    const satisfactionPrompt = [
        'Score only the end-user experience shown by the trajectory and workspace diff.',
        'A satisfied user can understand the result, run it locally, verify it, and continue editing it without hidden manual repair.',
        'Penalize unclear instructions, incomplete implementation, incoherent architecture, inaccessible UX, or unverifiable claims.',
        'Do not require or infer deployment evidence for an ordinary local trial.',
        'This score is supplemental and must never override executable authoritative hard gates.',
    ].join(' ');
    return {
        name: 'copilot-on-rails-qualitative-supplemental',
        description: 'Supplemental, uncalibrated user-satisfaction review; never a release authority.',
        version: '1',
        type: 'capability',
        tags: {
            component: 'copilot-on-rails',
            plane: 'vally-native',
            authority: 'supplemental-uncalibrated',
        },
        defaults: {
            runs: 1,
            timeout: '60m',
            model,
            judge_model: judges[0],
            executor: 'cor-aca',
        },
        stimuli: scenarios.map(scenario => ({
            name: scenario.id,
            prompt: scenario.prompt,
            tags: {
                ...scenario.tags,
                scenarioId: scenario.id,
                arm: 'rails',
                endpoint: 'local',
                model,
                qualitative: 'supplemental',
                validationCommandTimeoutMinutes: String(scenario.validation.timeoutMinutes),
            },
            environment: {
                env: {
                    COR_EVAL_SCENARIO_ID: scenario.id,
                    COR_EVAL_MODEL: model,
                    COR_EVAL_ARM: 'rails',
                    COR_EVAL_ENDPOINT: 'local',
                },
            },
            supported_executors: ['cor-aca'],
            artifacts: {
                include: ['trajectory.json', 'workspace.diff', 'reports/**'],
            },
            rubric: [
                'The delivered project completely satisfies the stated user request.',
                'The project is understandable, locally operable, maintainable, and ready for the user to continue.',
                'The trajectory and diff provide concrete evidence for claims; unsupported claims do not earn credit.',
            ],
            graders: [
                {
                    type: 'prompt',
                    name: 'user-satisfaction-prompt',
                    config: {
                        prompt: satisfactionPrompt,
                        model: judges[0],
                        scoring: 'scale_1_5',
                        threshold: 0.75,
                        evidence: ['trajectory', 'diff'],
                    },
                },
                {
                    type: 'panel',
                    name: 'user-satisfaction-panel',
                    config: {
                        prompt: satisfactionPrompt,
                        models: judges,
                        aggregation: 'median',
                        scoring: 'scale_1_5',
                        threshold: 0.75,
                        overall_threshold: 0.75,
                        evidence: ['trajectory', 'diff'],
                        criteria: [
                            {
                                name: 'task-satisfaction',
                                description: 'The output fulfills the explicit request without user repair.',
                                weight: 0.4,
                                pass_threshold: 0.75,
                                required: true,
                            },
                            {
                                name: 'local-operability',
                                description: 'The user can build, test, run, and debug from supplied assets.',
                                weight: 0.35,
                                pass_threshold: 0.75,
                                required: true,
                            },
                            {
                                name: 'clarity-and-coherence',
                                description: 'The implementation and guidance are coherent, accessible, and maintainable.',
                                weight: 0.25,
                                pass_threshold: 0.75,
                                required: true,
                            },
                        ],
                    },
                },
            ],
        })),
        scoring: {
            weights: {
                prompt: 0.5,
                panel: 0.5,
            },
            threshold: 0.75,
        },
    };
}

function createOracleEval(): Record<string, unknown> {
    return {
        name: 'copilot-on-rails-native-oracle-fixture',
        description: 'Offline strict-lint and custom-metrics oracle contract.',
        version: '1',
        type: 'capability',
        defaults: {
            runs: 1,
            model: 'oracle-no-live-model',
            executor: 'mock',
        },
        stimuli: [{
            name: 'authoritative-custom-metrics-oracle',
            prompt: 'Validate the authoritative custom metrics contract without invoking a live model.',
            tags: {
                component: 'copilot-on-rails',
                execution: 'offline-oracle',
            },
            graders: [{
                type: 'custom-metrics',
                config: {
                    path: 'custom_metrics.json',
                    assertions: [{ metric: 'authoritative_hard_gates_passed', equals: true }],
                },
            }],
            golden_custom_metrics: {
                path: 'oracle-custom-metrics.json',
            },
        }],
        scoring: {
            weights: { 'custom-metrics': 1 },
            threshold: 1,
        },
    };
}

function createExperiment(input: {
    name: string;
    evalFile: string;
    model: CorEvalModel;
    runs: number;
}): Record<string, unknown> {
    explicitModel(input.model);
    return {
        name: input.name,
        evals: [input.evalFile],
        overrides: {
            runs: input.runs,
            executor: 'mock',
            model: input.model,
            timeout: '60m',
        },
        execution: { workers: 5 },
        vary: ['/environment/env/COR_EVAL_ARM'],
        baseline: 'baseline',
        variants: {
            rails: {
                overrides: {
                    model: input.model,
                    executor: 'mock',
                },
                environment: {
                    env: {
                        COR_EVAL_ARM: 'rails',
                        COR_EVAL_MODEL: input.model,
                    },
                },
            },
            baseline: {
                overrides: {
                    model: input.model,
                    executor: 'mock',
                },
                environment: {
                    env: {
                        COR_EVAL_ARM: 'baseline-controlled',
                        COR_EVAL_MODEL: input.model,
                    },
                },
            },
        },
    };
}

export function requiredGatesForScenario(
    scenario: CorEvaluationScenario,
    endpoint: CorEvalEndpoint = 'local',
    evidenceTier: EvidenceTier = 'ordinary',
): string[] {
    const required = new Set<string>(['planning', 'model', 'provenance']);
    if (endpoint !== 'plan') {
        required.add('scaffold');
        if (scenario.validation.build) {
            required.add('build');
        }
        if (scenario.validation.test) {
            required.add('test');
        }
    }
    if (endpoint === 'local') {
        required.add('integration');
        const probes = scenario.acceptance?.local?.probes ?? [];
        const browserProbes = probes.filter(probe => probe.browser !== undefined);
        required.add('cleanup');
        if (scenario.acceptance?.local) {
            required.add('local-runtime');
        }
        if (browserProbes.length > 0) {
            required.add('browser');
            // The journey contract drives labels and DOM the prompt never specified, so a scenario
            // can mark it advisory: the outcome is still graded and recorded, it just stops
            // failing the run. The load contract above stays enforced either way.
            if (browserProbes.some(probe => (probe.browser?.journeySeverity ?? 'required') === 'required')) {
                required.add('browser-journey');
            }
            // Accessibility is graded only when a probe enforces it. A scenario opts out by setting
            // maxSeriousAccessibilityViolations to null, which keeps collecting axe evidence
            // without gating on it.
            if (browserProbes.some(probe => probe.browser?.maxSeriousAccessibilityViolations !== null)) {
                required.add('accessibility');
            }
        }
        if (browserProbes.some(probe => probe.browser?.persistence !== undefined
            && (probe.browser?.journeySeverity ?? 'required') === 'required')) {
            required.add('persistence');
        }
        if ((scenario.acceptance?.local?.storageEvents?.length ?? 0) > 0) {
            required.add('worker');
        }
        if (scenario.acceptance?.local?.debugParity) {
            required.add('debugger');
        }
        if (!['none', 'mock'].includes(scenario.tags.auth)) {
            required.add('security');
        }
    }
    if (evidenceTier === 'deployment-authorized') {
        required.add('deployment');
    }
    return allGates().filter(gate => required.has(gate));
}

function allGates(): string[] {
    return [
        'planning',
        'scaffold',
        'build',
        'test',
        'integration',
        'local-runtime',
        'browser',
        'browser-journey',
        'accessibility',
        'persistence',
        'worker',
        'debugger',
        'deployment',
        'security',
        'cleanup',
        'model',
        'provenance',
    ];
}

function requiredScenario(
    scenarios: Map<string, CorEvaluationScenario>,
    id: string,
): CorEvaluationScenario {
    const scenario = scenarios.get(id);
    if (!scenario) {
        throw new Error(`Required scenario is missing: ${id}`);
    }
    return scenario;
}

function validateOptions(options: NativeGenerationOptions): void {
    explicitModel(options.defaultModel);
    if (options.models.length !== COR_EVAL_MODELS.length
        || options.models.some((model, index) => model !== COR_EVAL_MODELS[index])) {
        throw new Error(`models must be the deliberate ordered set: ${COR_EVAL_MODELS.join(', ')}`);
    }
    for (const model of [...options.models, ...options.qualitativeJudgeModels]) {
        explicitModel(model);
    }
}

function explicitModel(model: string): void {
    if (!model.trim() || model.trim().toLowerCase() === 'auto') {
        throw new Error('Models must be supplied explicitly; "auto" and empty values are forbidden.');
    }
}

function yaml(value: unknown): string {
    return stringify(value, {
        lineWidth: 0,
        sortMapEntries: false,
    });
}

function fileSafeModel(model: string): string {
    return model.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
}

async function listGeneratedFiles(directory: string): Promise<string[]> {
    const files: string[] = [];
    const visit = async (current: string): Promise<void> => {
        const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'plugins') {
                    await visit(entryPath);
                }
            } else {
                files.push(entryPath);
            }
        }
    };
    await visit(directory);
    return files;
}

function isGeneratedSpec(filePath: string): boolean {
    return filePath.endsWith('.eval.yaml')
        || filePath.endsWith('.experiment.yaml')
        || filePath.endsWith('oracle-custom-metrics.json');
}

async function main(): Promise<void> {
    await writeNativeSpecs(checkedInGenerationOptions, process.argv.includes('--check'));
}

if (process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve('evals/vally/native/generate.ts')) {
    void main();
}
