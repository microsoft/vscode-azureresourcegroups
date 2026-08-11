/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-floating-promises -- node:test registrations are intentionally top-level. */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createEvaluationDefinition } from '../src/evaluationDefinition';
import type { CorEvaluationScenario } from '../src/scenario';
import {
    adapterSource,
    canUseTranscriptForQualitativeGrading,
    classifyTranscriptFidelity,
    convertAttempt,
    createCustomMetrics,
    createGroupReports,
    createPairingManifest,
    createTrajectory,
    runVallyAdapter,
    toTrialResultRecord,
    transcriptFidelity,
    validateSummary,
    type AttemptEvidence,
    type ConvertedAttempt,
    type LoadedSummary,
    type SummaryEvidence,
} from '../src/vally';

const scratchRoot = path.resolve('evals/results/vally-test-work');

describe('offline Vally summary adapter', () => {
    before(async () => {
        await fs.rm(scratchRoot, { recursive: true, force: true });
        await fs.mkdir(scratchRoot, { recursive: true });
    });

    after(async () => {
        await fs.rm(scratchRoot, { recursive: true, force: true });
    });

    test('converts only truthful summary evidence without assistant output or reasoning', () => {
        const scenario = makeScenario();
        const source = makeLoadedSummary();
        const attempt = makeAttempt({
            stages: [{
                name: 'scaffold',
                agentRun: {
                    outcome: 'completed',
                    sessionId: 'session-1',
                    startedAt: '2026-08-07T10:00:00.000Z',
                    completedAt: '2026-08-07T10:00:01.000Z',
                    usage: {
                        apiCalls: 1,
                        inputTokens: 12,
                        outputTokens: 3,
                        reasoningTokens: 2,
                        cacheReadTokens: 4,
                        totalNanoAiu: 50,
                        models: ['test-model'],
                    },
                    toolCalls: [{
                        toolCallId: 'tool-1',
                        toolName: 'view',
                        startedAt: '2026-08-07T10:00:00.100Z',
                        completedAt: '2026-08-07T10:00:00.200Z',
                        success: true,
                    }],
                    errors: ['archived error'],
                },
            }],
        });

        const trajectory = createTrajectory(
            source,
            attempt,
            scenario,
            'test-model',
            path.join(scratchRoot, 'source'),
            path.join(scratchRoot, 'artifacts'),
        );

        assert.equal(trajectory.output, '');
        assert.equal(trajectory.artifactDirStrict, true);
        assert.equal(trajectory.metadata.source, adapterSource);
        assert.equal(trajectory.metadata.transcriptFidelity, transcriptFidelity);
        assert.equal(
            trajectory.events.some(event =>
                event.type === 'assistant_message' || event.type === 'reasoning'),
            false,
        );
        assert.equal(
            trajectory.events.find(event => event.type === 'user_message')?.data.content,
            scenario.prompt,
        );
        assert.equal(trajectory.events.filter(event => event.type === 'tool_call').length, 1);
        assert.equal(
            trajectory.events.filter(event =>
                event.type === 'custom'
                && event.data.eventType === 'stage_token_cost_summary').length,
            1,
        );
        assert.equal(trajectory.metrics.tokenUsage.inputTokens, 12);
        assert.equal(trajectory.metrics.tokenUsage.cost?.amount, 50);
    });

    test('emits the primary Vally experiment, grading, reliability, and release surface', async () => {
        const scenarioId = 'api-ts-functions-minimal';
        const treatmentPath = path.join(scratchRoot, 'primary-treatment.json');
        const baselinePath = path.join(scratchRoot, 'primary-baseline.json');
        const output = path.join(scratchRoot, 'primary-report');
        const treatment = makeLoadedSummary('rails').summary;
        treatment.results = [{
            ...makeAttempt(),
            runId: 'primary-treatment',
            scenarioId,
            candidateCommit: treatment.candidateCommit,
            agentAssetsHash: treatment.agentAssetsHash,
        }];
        const baseline = makeLoadedSummary('baseline-controlled').summary;
        baseline.results = [{
            ...makeAttempt({
                evaluationArm: 'baseline-controlled',
                runId: 'primary-baseline',
                scenarioId,
                sourceProvenance: baseline.sourceProvenance,
            }),
            candidateCommit: baseline.candidateCommit,
            agentAssetsHash: baseline.agentAssetsHash,
        }];
        await Promise.all([
            fs.writeFile(treatmentPath, `${JSON.stringify(treatment)}\n`),
            fs.writeFile(baselinePath, `${JSON.stringify(baseline)}\n`),
        ]);

        const report = await runVallyAdapter({
            inputs: [treatmentPath],
            baselineInputs: [baselinePath],
            vscodeParityInputs: [],
            deploymentInputs: [],
            thresholdsPath: path.resolve('evals/release-thresholds.v1.json'),
            outputDirectory: output,
        });

        assert.equal(report.experiments.length, 1);
        assert.equal(report.experiments[0].model, 'test-model');
        assert.equal(report.experiments[0].exactPairs, 1);
        assert.equal(report.pairing.pairs.length, 1);
        assert(report.groups[0].passAtK['1'] !== undefined);
        assert(report.groups[0].passToTheK['1'] !== undefined);
        assert(report.releaseGates.results.length > 0);
        assert.equal(report.releaseAssessment.recommendation, 'insufficient_evidence');
        assert.equal(report.records.authoritativeEvidence, 'authoritative-evidence.json');
        const markdown = await fs.readFile(path.join(output, 'report.md'), 'utf8');
        assert.match(markdown, /## Release Assessment/);
        assert.match(markdown, /## Same-model Experiments/);
        assert.match(markdown, /## Vally Trial Reliability/);
        await fs.access(path.join(output, 'authoritative-evidence.json'));
        await fs.access(path.join(output, 'treatment', 'results.jsonl'));
    });

    test('distinguishes inapplicable gates from missing applicable evidence', () => {
        const source = makeLoadedSummary();
        const attempt = makeAttempt();
        const inapplicable = createCustomMetrics(source.summary, attempt, makeScenario());
        assert.equal(inapplicable.values.browser_functional_status, 'not-applicable');
        assert.equal(inapplicable.values.browser_functional_success, null);
        assert.equal(inapplicable.values.browser_check_count, null);

        const browserScenario = makeScenario({
            acceptance: {
                local: {
                    probes: [{
                        name: 'browser',
                        target: 'frontend',
                        browser: {
                            expectedText: 'Ready',
                            maxSeriousAccessibilityViolations: 0,
                            persistence: {
                                restartTargets: ['frontend'],
                                reload: 'current-url',
                                assertions: [{ kind: 'visible', selector: '#ready' }],
                            },
                        },
                    }],
                    storageEvents: [{
                        name: 'queue',
                        kind: 'queue',
                        inputQueue: 'input',
                        outputQueue: 'output',
                        message: { id: 1 },
                        expectedMessageIncludes: { id: 1 },
                    }],
                    debugParity: {
                        target: 'frontend',
                        sourceGlob: 'src/**/*.ts',
                        lineIncludes: 'ready',
                        triggerUrl: 'http://localhost:3000',
                    },
                },
            },
        });
        const missing = createCustomMetrics(source.summary, attempt, browserScenario);
        assert.equal(missing.values.browser_functional_status, 'missing-evidence');
        assert.equal(missing.values.browser_functional_success, false);
        assert.equal(missing.values.accessibility_status, 'missing-evidence');
        assert.equal(missing.values.persistence_status, 'missing-evidence');
        assert.equal(missing.values.worker_event_status, 'missing-evidence');
        assert.equal(missing.values.debugger_evidence_status, 'missing-evidence');
        assert.equal(missing.values.authoritative_hard_gates_passed, false);

        const supplemented = createCustomMetrics(source.summary, attempt, browserScenario, {
            vscodeParityOutcome: 'passed',
            deploymentOutcome: 'passed',
        });
        assert.equal(supplemented.values.debugger_evidence_status, 'passed');
        assert.equal(supplemented.values.debugger_evidence_success, true);
        assert.equal(supplemented.values.deployment_status, 'passed');
        assert.equal(supplemented.values.deployment_success, true);
    });

    test('grades custom metrics through Vally and zeros hard-failure aggregate scores', async () => {
        const passed = await convert(
            'passed',
            makeLoadedSummary(),
            makeAttempt(),
            makeScenario(),
        );
        const failed = await convert(
            'failed',
            makeLoadedSummary(),
            makeAttempt({ runId: 'run-failed', outcome: 'failed', failureCode: 'buildFailed' }),
            makeScenario(),
        );

        assert.equal(passed.grade.name, 'trajectory-grade');
        assert.equal(passed.grade.details?.[0].name, 'authoritative-hard-gates');
        assert.equal(passed.grade.passed, true);
        assert.equal(passed.effectiveGrade.score, 1);
        assert.equal(failed.grade.passed, false);
        assert.equal(failed.effectiveGrade.score, 0);
    });

    test('uses Vally pass@k, pass^k, and flakiness without pooling models or arms', async () => {
        const first = await convert('group-pass-1', makeLoadedSummary(), makeAttempt(), makeScenario());
        const second = await convert(
            'group-pass-2',
            makeLoadedSummary(),
            makeAttempt({ runId: 'run-pass-2', attempt: 2 }),
            makeScenario(),
        );
        const third = await convert(
            'group-fail',
            makeLoadedSummary(),
            makeAttempt({ runId: 'run-fail-3', attempt: 3, outcome: 'failed' }),
            makeScenario(),
        );
        const otherModel = {
            ...first,
            model: 'other-model',
            trajectory: {
                ...first.trajectory,
                id: `${first.trajectory.id}:other-model`,
            },
        };
        const groups = createGroupReports([first, second, third, otherModel]);
        assert.equal(groups.length, 2);
        const group = groups.find(item => item.model === 'test-model');
        assert.ok(group);
        assert.equal(group.trials, 3);
        assert.equal(group.passRate, 2 / 3);
        assert.ok(Math.abs(group.passAtK['1'] - 2 / 3) < Number.EPSILON);
        assert.equal(group.passAtK['2'], 1);
        assert.equal(group.passToTheK['2'], 4 / 9);
        assert.equal(group.flaky, true);
        assert.equal(group.aggregateScore, 2 / 3);
    });

    test('rejects unknown scenarios, duplicate run IDs, and unsafe baseline provenance', () => {
        const scenarioById = new Map([[makeScenario().id, makeScenario()]]);
        const summary = makeLoadedSummary().summary;
        summary.results = [makeAttempt()];
        const unknown = structuredClone(summary);
        unknown.results[0].scenarioId = 'unknown-scenario';
        assert.throws(
            () => validateSummary(unknown, 'unknown-summary.json', 'rails', scenarioById),
            /Unknown scenario/,
        );

        const duplicate = structuredClone(summary);
        duplicate.results.push(structuredClone(duplicate.results[0]));
        assert.throws(
            () => validateSummary(duplicate, 'duplicate-summary.json', 'rails', scenarioById),
            /Duplicate runId/,
        );

        const baseline = structuredClone(summary);
        baseline.evaluationArm = 'baseline-controlled';
        baseline.results[0].evaluationArm = 'baseline-controlled';
        assert.throws(
            () => validateSummary(
                baseline,
                'baseline-summary.json',
                'baseline-controlled',
                scenarioById,
            ),
            /Baseline source provenance/,
        );
    });

    test('pairs only exact model, scenario, attempt, and endpoint matches', async () => {
        const treatment = await convert(
            'pair-treatment',
            makeLoadedSummary(),
            makeAttempt(),
            makeScenario(),
        );
        const baselineSource = makeLoadedSummary('baseline-controlled');
        const baseline = await convert(
            'pair-baseline',
            baselineSource,
            makeAttempt({
                runId: 'baseline-run',
                evaluationArm: 'baseline-controlled',
            }),
            makeScenario(),
        );
        const wrongEndpoint: ConvertedAttempt = {
            ...baseline,
            runId: 'baseline-wrong-endpoint',
            endpoint: 'scaffold',
            trajectory: {
                ...baseline.trajectory,
                id: `${baseline.trajectory.id}:scaffold`,
            },
        };

        const exact = createPairingManifest([treatment], [baseline]);
        assert.equal(exact.pairs.length, 1);
        assert.equal(exact.matchingKey, 'model+scenarioId+attempt+endpoint');
        assert.equal(exact.qualitativeComparison.performed, false);

        const mismatch = createPairingManifest([treatment], [wrongEndpoint]);
        assert.equal(mismatch.pairs.length, 0);
        assert.equal(mismatch.unmatchedTreatment.length, 1);
        assert.equal(mismatch.unmatchedBaseline.length, 1);

        const evaluationDefinition = createEvaluationDefinition(
            ['test-scenario'],
            [{ path: 'evals/scenarios/test-scenario.json', content: 'scenario' }],
            [{ path: 'evals/src/vally.ts', content: 'evaluator' }],
            [{ path: 'resources/agents/test.md', content: 'product' }],
        );
        assert.throws(
            () => createPairingManifest(
                [{ ...treatment, evaluationDefinition }],
                [baseline],
            ),
            /evaluation definition mismatch.*legacy_missing/,
        );
    });

    test('emits a Vally trial-result JSONL-compatible shape', async () => {
        const converted = await convert(
            'jsonl-shape',
            makeLoadedSummary(),
            makeAttempt(),
            makeScenario(),
        );
        const record = toTrialResultRecord(converted, 1);
        const roundTrip = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
        assert.equal(roundTrip.type, 'trial-result');
        assert.equal(roundTrip.variant, 'rails');
        assert.equal(roundTrip.status, 'success');
        assert.equal(roundTrip.trialIndex, 0);
        assert.ok(roundTrip.gradeResult);
        assert.ok(roundTrip.trajectory);
        assert.equal(
            (roundTrip.trajectory as { metadata: { transcriptFidelity: string } })
                .metadata.transcriptFidelity,
            'summary-only',
        );
    });

    test('maps captured SDK timelines and classifies full and mixed transcript fidelity', () => {
        const fullAttempt = makeAttempt({
            stages: [
                capturedStage('scaffold', 'session-1', 'Full response'),
                capturedStage('local', 'session-2', 'Final response'),
            ],
        });
        const mixedAttempt = makeAttempt({
            stages: [
                capturedStage('scaffold', 'session-1', 'Observed response'),
                {
                    name: 'local',
                    agentRun: historicalAgentRun('session-2'),
                },
            ],
        });

        assert.equal(classifyTranscriptFidelity(fullAttempt), 'full');
        assert.equal(classifyTranscriptFidelity(mixedAttempt), 'mixed');
        assert.equal(canUseTranscriptForQualitativeGrading('full'), true);
        assert.equal(canUseTranscriptForQualitativeGrading('mixed'), true);
        assert.equal(canUseTranscriptForQualitativeGrading('summary-only'), false);

        const trajectory = createTrajectory(
            makeLoadedSummary(),
            fullAttempt,
            makeScenario(),
            'test-model',
            path.join(scratchRoot, 'source'),
            path.join(scratchRoot, 'artifacts'),
        );
        assert.equal(trajectory.metadata.transcriptFidelity, 'full');
        assert.equal(trajectory.metadata.tokenUsageFidelity, 'event-timeline');
        assert.equal(trajectory.metadata.outputProvenance, 'captured-assistant-message');
        assert.equal(trajectory.output, 'Full response\n\nFinal response');
        assert.equal(trajectory.events.filter(event => event.type === 'assistant_message').length, 2);
        assert.equal(trajectory.events.filter(event => event.type === 'turn_start').length, 2);
        assert.equal(trajectory.events.filter(event => event.type === 'turn_end').length, 2);
        assert.equal(trajectory.events.filter(event => event.type === 'tool_call').length, 2);
        assert.equal(trajectory.events.filter(event => event.type === 'tool_result').length, 2);
        assert.equal(trajectory.events.filter(event => event.type === 'token_usage').length, 2);
        assert.equal(trajectory.events.filter(event => event.type === 'error').length, 2);
        assert.equal(trajectory.events.some(event => event.type === 'reasoning'), false);
        assert.match(String(trajectory.events.find(event => event.type === 'assistant_message')?.agentId), /scaffold/);
    });

    test('keeps mixed evidence partial and survives Vally record serialization', async () => {
        const attempt = makeAttempt({
            stages: [
                capturedStage('scaffold', 'session-1', 'Observed response'),
                { name: 'local', agentRun: historicalAgentRun('session-2') },
            ],
        });
        const converted = await convert('mixed-record', makeLoadedSummary(), attempt, makeScenario());
        const record = JSON.parse(JSON.stringify(toTrialResultRecord(converted, 1))) as {
            trajectory: {
                output: string;
                metadata: { transcriptFidelity: string; tokenUsageFidelity: string };
                events: { type: string }[];
            };
        };

        assert.equal(record.trajectory.metadata.transcriptFidelity, 'mixed');
        assert.equal(record.trajectory.metadata.tokenUsageFidelity, 'mixed');
        assert.equal(record.trajectory.output, 'Observed response');
        assert(record.trajectory.events.some(event => event.type === 'assistant_message'));
        assert(record.trajectory.events.some(event => event.type === 'custom'));
    });
});

async function convert(
    name: string,
    source: LoadedSummary,
    attempt: AttemptEvidence,
    scenario: CorEvaluationScenario,
): Promise<ConvertedAttempt> {
    return await convertAttempt(
        source,
        attempt,
        scenario,
        path.join(scratchRoot, name),
    );
}

function makeLoadedSummary(arm: SummaryEvidence['evaluationArm'] = 'rails'): LoadedSummary {
    const sourceProvenance = arm === 'baseline-controlled'
        ? {
            promptSource: 'evals/scenarios/test-scenario.json#baselinePrompt',
            promptField: 'baselinePrompt',
            agentIdentity: 'copilot-sdk-generic',
            workspaceSeed: 'empty',
            railsAssetsInjected: false,
            customToolsInjected: false,
        }
        : undefined;
    return {
        summaryPath: path.join(scratchRoot, `${arm}-summary.json`),
        summary: {
            schemaVersion: '1',
            evaluationArm: arm,
            startedAt: '2026-08-07T10:00:00.000Z',
            completedAt: '2026-08-07T10:00:02.000Z',
            candidateCommit: 'abc123',
            agentAssetsHash: 'assets123',
            through: 'local',
            requestedModel: 'test-model',
            observedModels: ['test-model'],
            sourceProvenance,
            results: [],
        },
    };
}

function makeAttempt(overrides: Partial<AttemptEvidence> = {}): AttemptEvidence {
    return {
        schemaVersion: '1',
        evaluationArm: 'rails',
        runId: 'run-1',
        scenarioId: 'test-scenario',
        attempt: 1,
        outcome: 'autonomous_success',
        durationMs: 2000,
        agentRetries: 0,
        requestedModel: 'test-model',
        model: 'test-model',
        observedModels: ['test-model'],
        stages: [],
        ...overrides,
    };
}

function makeScenario(overrides: Partial<CorEvaluationScenario> = {}): CorEvaluationScenario {
    return {
        schemaVersion: '1',
        id: 'test-scenario',
        prompt: 'Build the Rails treatment fixture.',
        baselinePrompt: 'Build the same standalone fixture without any Rails-specific agents or '
            + 'assets, then include all required implementation, test, and runtime files.',
        tags: { component: 'test' },
        validation: {
            profile: 'standard',
            build: true,
            test: true,
            lint: 'if-present',
            timeoutMinutes: 5,
        },
        acceptance: {
            local: {
                probes: [{ name: 'health', target: 'backend', url: 'http://localhost:3000/health' }],
            },
        },
        ...overrides,
    };
}

function capturedStage(name: string, sessionId: string, content: string): AttemptEvidence['stages'][number] {
    return {
        name,
        agentRun: {
            ...historicalAgentRun(sessionId),
            eventTimeline: [
                {
                    type: 'assistant.turn_start',
                    timestamp: '2026-08-07T10:00:00.000Z',
                    turnId: `${name}-turn`,
                    model: 'test-model',
                },
                {
                    type: 'assistant.message',
                    timestamp: '2026-08-07T10:00:00.100Z',
                    turnId: `${name}-turn`,
                    messageId: `${name}-message`,
                    model: 'test-model',
                    content,
                },
                {
                    type: 'tool.execution_start',
                    timestamp: '2026-08-07T10:00:00.200Z',
                    turnId: `${name}-turn`,
                    toolCallId: `${name}-tool`,
                    toolName: 'view',
                    arguments: { path: 'src/index.ts' },
                },
                {
                    type: 'tool.execution_complete',
                    timestamp: '2026-08-07T10:00:00.300Z',
                    turnId: `${name}-turn`,
                    toolCallId: `${name}-tool`,
                    toolName: 'view',
                    success: true,
                    result: 'file content',
                },
                {
                    type: 'assistant.usage',
                    timestamp: '2026-08-07T10:00:00.400Z',
                    turnId: `${name}-turn`,
                    model: 'test-model',
                    inputTokens: 12,
                    outputTokens: 3,
                    reasoningTokens: 2,
                    cacheReadTokens: 4,
                    cacheWriteTokens: 0,
                    totalNanoAiu: 50,
                },
                {
                    type: 'session.error',
                    timestamp: '2026-08-07T10:00:00.500Z',
                    turnId: `${name}-turn`,
                    errorType: 'query',
                    message: 'archived error',
                },
                {
                    type: 'assistant.turn_end',
                    timestamp: '2026-08-07T10:00:00.600Z',
                    turnId: `${name}-turn`,
                    model: 'test-model',
                },
            ],
        },
    };
}

function historicalAgentRun(sessionId: string): NonNullable<AttemptEvidence['stages'][number]['agentRun']> {
    return {
        outcome: 'completed',
        sessionId,
        startedAt: '2026-08-07T10:00:00.000Z',
        completedAt: '2026-08-07T10:00:01.000Z',
        usage: {
            apiCalls: 1,
            inputTokens: 12,
            outputTokens: 3,
            reasoningTokens: 2,
            cacheReadTokens: 4,
            totalNanoAiu: 50,
            models: ['test-model'],
        },
        toolCalls: [{
            toolCallId: 'tool-1',
            toolName: 'view',
            startedAt: '2026-08-07T10:00:00.100Z',
            completedAt: '2026-08-07T10:00:00.200Z',
            success: true,
        }],
        errors: ['archived error'],
    };
}
