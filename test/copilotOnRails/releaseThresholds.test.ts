/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import {
    EvaluationAttempt,
    EvaluationSummary,
    createReport,
    renderMarkdown,
} from '../../evals/src/report';
import {
    ReleaseThresholds,
    loadReleaseThresholds,
    validateReleaseThresholds,
} from '../../evals/src/releaseThresholds';
import { CorEvaluationScenario } from '../../evals/src/scenario';
import {
    EvaluationDefinitionProvenance,
    createEvaluationDefinition,
} from '../../evals/src/evaluationDefinition';

const model = 'release-test-model';

suite('Evaluation release thresholds', () => {
    test('validates the checked-in versioned threshold configuration', () => {
        const thresholds = loadReleaseThresholds();
        assert.equal(thresholds.schemaVersion, '1');
        assert.equal(thresholds.thresholdSet, 'copilot-on-rails-release-v1');
        assert.throws(
            () => validateReleaseThresholds({
                ...thresholds,
                outcomes: { ...thresholds.outcomes, minimumFinalSuccessRate: 1.1 },
            }),
            /minimumFinalSuccessRate must be a number from 0 to 1/,
        );
    });

    test('passes complete evidence and emits machine-readable and Markdown gates', () => {
        const fixture = releaseFixture();
        const report = createReport(
            [fixture.candidate],
            fixture.scenarios,
            [fixture.baseline],
            [fixture.parity],
            [fixture.deployment],
            fixture.thresholds,
        );

        assert.equal(report.releaseAssessment.recommendation, 'candidate');
        assert(report.releaseGates);
        assert.equal(
            report.releaseGates.results.filter(gate => gate.status !== 'passed').length,
            0,
        );
        assert.equal(gate(report, 'same-model-baseline').status, 'passed');
        assert.equal(gate(report, 'cost-multiplier').status, 'passed');
        assert.match(renderMarkdown(report), /### Release Gates/);
        assert.match(renderMarkdown(report), /Same-model paired baseline/);
    });

    test('distinguishes failed, missing, and not-applicable gates', () => {
        const failing = releaseFixture();
        const failingCandidate = {
            ...failing.candidate,
            results: failing.candidate.results.map((attempt, index) => index
                ? attempt
                : {
                    ...attempt,
                    stages: [{
                        ...attempt.stages?.[0],
                        localRuntimeValidation: {
                            ...attempt.stages?.[0].localRuntimeValidation,
                            browserChecks: [{
                                success: false,
                                accessibilityScanned: true,
                                seriousAccessibilityViolations: ['color-contrast:serious'],
                            }],
                            persistenceChecks: [{ success: true }],
                        },
                    }],
                }),
        };
        const failedReport = createReport(
            [failingCandidate],
            failing.scenarios,
            [failing.baseline],
            [withRunId(failing.parity, failingCandidate.results[0])],
            [withRunId(failing.deployment, failingCandidate.results[0])],
            failing.thresholds,
        );
        assert.equal(gate(failedReport, 'ui-accessibility-violations').status, 'failed');
        assert.equal(failedReport.releaseAssessment.recommendation, 'hold');

        const missing = releaseFixture();
        const missingCandidate = {
            ...missing.candidate,
            results: missing.candidate.results.map(attempt =>
                attempt.scenarioId === 'ui-scenario'
                    ? { ...attempt, stages: [{ name: 'local-runtime' }] }
                    : attempt),
        };
        const missingReport = createReport(
            [missingCandidate],
            missing.scenarios,
            [missing.baseline],
            [withRunId(missing.parity, missingCandidate.results[0])],
            [withRunId(missing.deployment, missingCandidate.results[0])],
            missing.thresholds,
        );
        assert.equal(gate(missingReport, 'ui-browser').status, 'missing_evidence');
        assert.equal(gate(missingReport, 'persistence').status, 'missing_evidence');
        assert.equal(missingReport.releaseAssessment.recommendation, 'insufficient_evidence');

        const apiOnly = releaseFixture([apiScenario()]);
        const notApplicableReport = createReport(
            [apiOnly.candidate],
            apiOnly.scenarios,
            [apiOnly.baseline],
            [],
            [apiOnly.deployment],
            apiOnly.thresholds,
        );
        assert.equal(gate(notApplicableReport, 'ui-browser').status, 'not_applicable');
        assert.equal(gate(notApplicableReport, 'persistence').status, 'not_applicable');
        assert.equal(gate(notApplicableReport, 'worker-side-effects').status, 'not_applicable');
        assert.equal(gate(notApplicableReport, 'debugger-evidence').status, 'not_applicable');
    });

    test('fails closed for absent baseline cost evidence and model mismatches', () => {
        const fixture = releaseFixture([apiScenario()]);
        const noBaseline = createReport(
            [fixture.candidate],
            fixture.scenarios,
            [],
            [],
            [fixture.deployment],
            fixture.thresholds,
        );
        assert.equal(gate(noBaseline, 'same-model-baseline').status, 'missing_evidence');
        assert.equal(gate(noBaseline, 'cost-multiplier').status, 'missing_evidence');

        const mismatchedBaseline = {
            ...fixture.baseline,
            requestedModel: 'different-model',
            observedModels: ['different-model'],
            results: fixture.baseline.results.map(attempt => ({
                ...attempt,
                model: 'different-model',
                requestedModel: 'different-model',
                observedModels: ['different-model'],
            })),
        };
        assert.throws(
            () => createReport(
                [fixture.candidate],
                fixture.scenarios,
                [mismatchedBaseline],
                [],
                [fixture.deployment],
                fixture.thresholds,
            ),
            /requested different models/,
        );
    });
});

function gate(report: ReturnType<typeof createReport>, id: string) {
    const value = report.releaseGates?.results.find(result => result.id === id);
    assert(value, `Missing release gate ${id}`);
    return value;
}

function releaseFixture(scenarios = [uiScenario(), workerScenario()]) {
    const thresholds: ReleaseThresholds = {
        ...loadReleaseThresholds(),
        outcomes: {
            minimumFinalSuccessRate: 1,
            minimumFirstPassSuccessRate: 1,
        },
    };
    const definition = testDefinition(scenarios.map(scenario => scenario.id));
    const candidateAttempts = scenarios.flatMap(scenario =>
        Array.from({ length: 3 }, (_, index) => attempt(
            `candidate-${scenario.id}-${index + 1}`,
            scenario,
            index + 1,
            'rails',
            definition,
        )));
    const baselineAttempts = scenarios.flatMap(scenario =>
        Array.from({ length: 3 }, (_, index) => attempt(
            `baseline-${scenario.id}-${index + 1}`,
            scenario,
            index + 1,
            'baseline-controlled',
            definition,
        )));
    const candidate = summary('rails', candidateAttempts, definition);
    const baseline = summary('baseline-controlled', baselineAttempts, definition);
    const source = candidateAttempts[0];
    const sourceScenario = scenarios[0];
    return {
        thresholds,
        scenarios,
        candidate,
        baseline,
        parity: {
            outcome: 'passed' as const,
            sourceProvenance: {
                evaluationArm: 'rails' as const,
                through: 'local' as const,
                runId: source.runId,
                scenarioId: source.scenarioId,
                attempt: source.attempt,
                candidateCommit: 'candidate',
                agentAssetsHash: 'assets',
                evaluationDefinition: definition,
                requestedModel: model,
                observedModels: [model],
                debugParity: sourceScenario.acceptance?.local?.debugParity as NonNullable<
                    CorEvaluationScenario['acceptance']
                >['local'] extends infer T
                    ? T extends { debugParity?: infer D } ? D : never
                    : never,
            },
        },
        deployment: {
            outcome: 'passed' as const,
            runId: 'deployment',
            environmentName: 'release-test',
            commands: [],
            cleanupVerified: true,
            sourceProvenance: {
                evaluationArm: 'rails' as const,
                through: 'local' as const,
                runId: source.runId,
                scenarioId: source.scenarioId,
                attempt: source.attempt,
                candidateCommit: 'candidate',
                agentAssetsHash: 'assets',
                evaluationDefinition: definition,
                requestedModel: model,
                observedModels: [model],
            },
        },
    };
}

function summary(
    arm: 'rails' | 'baseline-controlled',
    results: EvaluationAttempt[],
    definition: EvaluationDefinitionProvenance,
): EvaluationSummary {
    return {
        candidateCommit: 'candidate',
        agentAssetsHash: arm === 'rails' ? 'assets' : 'not-applicable:baseline-controlled',
        through: 'local',
        evaluationArm: arm,
        requestedModel: arm === 'baseline-controlled' ? model : undefined,
        requestedModels: arm === 'rails' ? [model] : undefined,
        observedModels: [model],
        evaluationDefinitions: [definition],
        results,
    };
}

function attempt(
    runId: string,
    scenario: CorEvaluationScenario,
    attemptNumber: number,
    arm: 'rails' | 'baseline-controlled',
    definition: EvaluationDefinitionProvenance,
): EvaluationAttempt {
    const ui = scenario.id === 'ui-scenario';
    const worker = scenario.id === 'worker-scenario';
    return {
        evaluationArm: arm,
        runId,
        scenarioId: scenario.id,
        attempt: attemptNumber,
        outcome: 'autonomous_success',
        candidateCommit: 'candidate',
        agentAssetsHash: arm === 'rails' ? 'assets' : 'not-applicable:baseline-controlled',
        evaluationDefinition: definition,
        model,
        requestedModel: model,
        observedModels: [model],
        durationMs: 100,
        agentRetries: 0,
        stages: [{
            name: 'local-runtime',
            agentRun: {
                outcome: 'completed',
                usage: {
                    inputTokens: 10,
                    outputTokens: 5,
                    totalNanoAiu: 100,
                    models: [model],
                },
            },
            localRuntimeValidation: {
                outcome: 'passed',
                browserChecks: ui ? [{
                    success: true,
                    accessibilityScanned: true,
                    seriousAccessibilityViolations: [],
                }] : undefined,
                persistenceChecks: ui ? [{ success: true }] : undefined,
                workerEvents: worker ? [{ success: true }] : undefined,
            },
        }],
    };
}

function testDefinition(scenarioIds: string[]): EvaluationDefinitionProvenance {
    return createEvaluationDefinition(
        scenarioIds,
        scenarioIds.map(id => ({ path: `evals/scenarios/${id}.json`, content: id })),
        [{ path: 'evals/src/run.ts', content: 'evaluator' }],
        [{ path: 'resources/agents/agent.md', content: 'product' }],
    );
}

function apiScenario(): CorEvaluationScenario {
    return scenario('api-scenario');
}

function uiScenario(): CorEvaluationScenario {
    return scenario('ui-scenario', {
        local: {
            probes: [{
                name: 'ui',
                target: 'frontend',
                method: 'GET',
                url: 'http://127.0.0.1:3000',
                expectedStatus: 200,
                browser: {
                    persistence: {
                        restartTargets: ['frontend'],
                        reload: 'current-url',
                        assertions: [{ kind: 'visible', selector: '#saved' }],
                    },
                },
            }],
            debugParity: {
                target: 'frontend',
                sourceGlob: '**/src/main.ts',
                lineIncludes: 'bootstrap',
                triggerUrl: 'http://127.0.0.1:3000',
            },
        },
    });
}

function workerScenario(): CorEvaluationScenario {
    return scenario('worker-scenario', {
        local: {
            probes: [{ name: 'worker', target: 'worker', processPattern: 'worker' }],
            storageEvents: [{
                name: 'queue event',
                kind: 'queue',
                inputQueue: 'input',
                outputQueue: 'output',
                message: { id: '1' },
                expectedMessageIncludes: { id: '1' },
            }],
        },
    });
}

function scenario(
    id: string,
    acceptance?: NonNullable<CorEvaluationScenario['acceptance']>,
): CorEvaluationScenario {
    return {
        schemaVersion: '1',
        id,
        prompt: 'Build a project.',
        baselinePrompt: 'Build a complete standalone project with source code, configuration, tests, local debugging support, and deployment-ready infrastructure.',
        tags: { archetype: 'test' },
        validation: {
            profile: 'minimal',
            build: true,
            test: true,
            lint: 'required',
            timeoutMinutes: 5,
        },
        acceptance,
    };
}

function withRunId<T extends { sourceProvenance?: Record<string, unknown> }>(
    value: T,
    attemptValue: EvaluationAttempt,
): T {
    return {
        ...value,
        sourceProvenance: {
            ...value.sourceProvenance,
            runId: attemptValue.runId,
        },
    };
}
