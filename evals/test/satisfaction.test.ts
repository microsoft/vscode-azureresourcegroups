/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/naming-convention -- Vally configs and evidence use stable snake_case wire keys. */
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test registrations are intentionally top-level. */

import {
    computeMetrics,
} from '@microsoft/vally';
import type {
    GraderResult,
    LlmClient,
    LlmJudgeOptions,
    LlmJudgeResponse,
} from '@microsoft/vally';
import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import { afterEach, test } from 'node:test';
import * as os from 'os';
import * as path from 'path';
import {
    createSatisfactionRubric,
    runSatisfactionEvaluation,
} from '../src/satisfaction';
import type {
    AdapterTrajectory,
    CustomMetricsDocument,
} from '../src/vally';
import type { CorEvaluationScenario } from '../src/scenario';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })),
    );
});

test('builds an applicability-aware satisfaction rubric', () => {
    const scenario: CorEvaluationScenario = {
        schemaVersion: '1',
        id: 'rubric-test',
        prompt: 'Build an application.',
        baselinePrompt: 'Build a complete standalone application with local debugging, tests, and deployment configuration.',
        tags: {
            archetype: 'crud',
            frontend: 'react',
            backend: 'functions',
            database: 'postgres',
            auth: 'mock',
            complexity: 'medium',
        },
        validation: {
            profile: 'standard',
            build: true,
            test: true,
            lint: 'required',
            timeoutMinutes: 5,
        },
        acceptance: {
            local: {
                compound: true,
                probes: [
                    {
                        name: 'browser',
                        target: 'frontend',
                        method: 'GET',
                        url: 'http://127.0.0.1:5173',
                        expectedStatus: 200,
                        browser: {
                            persistence: {
                                restartTargets: ['frontend'],
                                reload: 'current-url',
                                assertions: [{ kind: 'visible', selector: 'main' }],
                            },
                        },
                    },
                ],
            },
        },
    };
    const plan = createSatisfactionRubric(scenario, 'plan');
    const local = createSatisfactionRubric(scenario, 'local');
    assert.equal(plan.length, 2);
    assert(local.some(item => item.startsWith('Local developer experience:')));
    assert(local.some(item => item.startsWith('Frontend satisfaction:')));
    assert(local.some(item => item.startsWith('Reliability and durability:')));
    assert(!plan.some(item => item.startsWith('Deployment experience:')));
});

test('grades grounded evidence, normalizes failed hard gates, and compares exact pairs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-satisfaction-test-'));
    temporaryDirectories.push(root);
    const input = path.join(root, 'vally');
    const output = path.join(root, 'report');
    await writeAttempt(input, root, 'treatment', 'rails-run', true);
    await writeAttempt(input, root, 'baseline', 'baseline-run', false);

    const client = new FakeLlmClient();
    const report = await runSatisfactionEvaluation({
        inputDirectory: input,
        outputDirectory: output,
        judgeModels: ['judge-model'],
        reasoningEffort: 'low',
        mode: 'all',
    }, client);

    assert.equal(report.attempts.length, 2);
    assert.equal(report.comparisons.length, 1);
    assert.equal(report.comparisons[0].model, 'gpt-5.6-sol');
    const treatment = report.attempts.find(item => item.arm === 'rails');
    const baseline = report.attempts.find(item => item.arm === 'baseline-controlled');
    assert(treatment && baseline);
    assert.equal(treatment.effectiveScore, treatment.judge.score);
    assert.equal(baseline.effectiveScore, 0);
    assert.equal(baseline.effectivePassed, false);
    assert.equal(report.comparisons[0].bothHardGatesPassed, false);
    assert(client.messages.every(message => message.includes('evaluator evidence packet')
        || message.includes('Evaluator evidence packet')
        || message.includes('Evidence Packet')));
    assert(await exists(path.join(output, 'satisfaction-report.json')));
    assert(await exists(path.join(output, 'satisfaction-report.md')));
    assert(await exists(path.join(output, 'attempts', 'rails-run', 'evidence.json')));
    assert(await exists(path.join(output, 'attempts', 'rails-run', 'judge.json')));
});

async function writeAttempt(
    inputRoot: string,
    fixtureRoot: string,
    armDirectory: 'treatment' | 'baseline',
    runId: string,
    hardGatePassed: boolean,
): Promise<void> {
    const sourceArtifactDir = path.join(fixtureRoot, 'source', runId);
    const outputArtifactDir = path.join(inputRoot, armDirectory, 'attempts', runId);
    await Promise.all([
        fs.mkdir(path.join(sourceArtifactDir, '.azure'), { recursive: true }),
        fs.mkdir(path.join(sourceArtifactDir, 'workspace'), { recursive: true }),
        fs.mkdir(outputArtifactDir, { recursive: true }),
    ]);
    await Promise.all([
        fs.writeFile(
            path.join(sourceArtifactDir, 'run-result.json'),
            JSON.stringify({
                runId,
                outcome: hardGatePassed ? 'autonomous_success' : 'failed',
                stages: [{ name: 'local-runtime', localRuntimeValidation: { outcome: hardGatePassed ? 'passed' : 'failed' } }],
            }),
        ),
        fs.writeFile(path.join(sourceArtifactDir, '.azure', 'requirements.json'), '{"project":"ticket app"}'),
        fs.writeFile(path.join(sourceArtifactDir, '.azure', 'project-plan.md'), '# Project Plan\n\nA clear plan.'),
        fs.writeFile(path.join(sourceArtifactDir, 'workspace', 'README.md'), '# Ticket app\n\nRun with F5.'),
        fs.writeFile(path.join(sourceArtifactDir, 'workspace', 'package.json'), '{"scripts":{"test":"vitest"}}'),
    ]);

    const trajectory = createTrajectory(
        armDirectory === 'treatment' ? 'rails' : 'baseline-controlled',
        runId,
        sourceArtifactDir,
        outputArtifactDir,
    );
    const metrics = createMetrics(hardGatePassed);
    const hardGate: GraderResult = {
        name: 'aggregate',
        kind: 'code',
        passed: hardGatePassed,
        score: hardGatePassed ? 1 : 0,
        evidence: hardGatePassed ? 'All hard gates passed.' : 'A hard gate failed.',
    };
    await Promise.all([
        fs.writeFile(path.join(outputArtifactDir, 'trajectory.json'), JSON.stringify(trajectory)),
        fs.writeFile(path.join(outputArtifactDir, 'custom_metrics.json'), JSON.stringify(metrics)),
        fs.writeFile(path.join(outputArtifactDir, 'grade.json'), JSON.stringify({ effectiveGrade: hardGate })),
    ]);
}

function createTrajectory(
    arm: 'rails' | 'baseline-controlled',
    runId: string,
    sourceArtifactDir: string,
    artifactDir: string,
): AdapterTrajectory {
    const timestamp = new Date('2026-08-07T10:00:00.000Z');
    const events: AdapterTrajectory['events'] = [
        {
            type: 'user_message',
            timestamp,
            turn: 0,
            data: { content: 'Build a ticket application.' },
        },
        {
            type: 'turn_end',
            timestamp,
            turn: 0,
            data: { turnId: 'turn-0' },
        },
    ];
    return {
        id: `copilot-on-rails-summary-adapter:${runId}`,
        stimulus: {
            name: 'ticket-eval',
            prompt: 'Build a ticket application.',
            tags: {
                scenario: 'crud-react-functions-postgres',
                model: 'gpt-5.6-sol',
                arm,
                endpoint: 'local',
            },
        },
        events,
        metrics: computeMetrics(events),
        output: '',
        workDir: sourceArtifactDir,
        artifactDir,
        artifactDirStrict: true,
        metadata: {
            model: 'gpt-5.6-sol',
            skillsLoaded: [],
            executor: 'copilot-on-rails-summary-adapter',
            sessionID: runId,
            source: 'copilot-on-rails-summary-adapter',
            transcriptFidelity: 'summary-only',
            tokenUsageFidelity: 'stage-summary',
            summaryPath: path.join(sourceArtifactDir, '..', 'summary.json'),
            sourceArtifactDir,
            evaluationArm: arm,
            endpoint: 'local',
            scenarioId: 'crud-react-functions-postgres',
            attempt: 1,
        },
    };
}

function createMetrics(passed: boolean): CustomMetricsDocument {
    return {
        schema: 'copilot-on-rails-vally-custom-metrics/v1',
        source: 'copilot-on-rails-summary-adapter',
        transcriptFidelity: 'summary-only',
        values: {
            autonomous_success: passed,
            final_product_success: passed,
            first_pass_success: passed,
            product_quality_included: true,
            product_quality_success: passed,
            repair_count: 0,
            stage_depth: 8,
            duration_ms: 1000,
            input_tokens: 100,
            output_tokens: 20,
            reasoning_tokens: 0,
            cache_read_tokens: 0,
            total_tokens: 120,
            total_nano_aiu: 1000,
            browser_functional_applicable: true,
            browser_functional_status: passed ? 'passed' : 'failed',
            browser_functional_success: passed,
            browser_check_count: 1,
            accessibility_applicable: true,
            accessibility_status: passed ? 'passed' : 'failed',
            accessibility_success: passed,
            accessibility_scan_count: 1,
            accessibility_finding_count: passed ? 0 : 1,
            persistence_applicable: true,
            persistence_status: passed ? 'passed' : 'failed',
            persistence_success: passed,
            persistence_check_count: 1,
            worker_event_applicable: false,
            worker_event_status: 'not-applicable',
            worker_event_success: null,
            worker_event_check_count: null,
            debugger_evidence_applicable: true,
            debugger_evidence_status: passed ? 'passed' : 'failed',
            debugger_evidence_success: passed,
            debugger_check_count: 1,
            deployment_evidence_present: false,
            deployment_status: 'not-applicable',
            deployment_success: null,
            authoritative_hard_gates_passed: passed,
        },
    };
}

class FakeLlmClient implements LlmClient {
    public readonly messages: string[] = [];

    public async judge<TArgs>(options: LlmJudgeOptions<TArgs>): Promise<LlmJudgeResponse<TArgs>> {
        this.messages.push(options.userMessage);
        const candidate = options.tool.name.includes('comparison')
            ? {
                rubric_results: [{
                    criterion: 'overall satisfaction',
                    winner: 'tie',
                    magnitude: 'equal',
                    reasoning: 'The bounded evidence is equivalent.',
                }],
                overall_winner: 'tie',
                overall_magnitude: 'equal',
                overall_reasoning: 'The bounded evidence is equivalent.',
            }
            : {
                rubric_scores: [{
                    criterion: 'overall satisfaction',
                    score: 4,
                    reasoning: 'The evidence is clear and the hard-gate state is explicit.',
                }],
                overall_score: 4,
                overall_reasoning: 'The evidence packet supports a good local journey.',
            };
        const parsed = options.tool.parameters.safeParse(candidate);
        if (!parsed.success) {
            throw new Error(parsed.error.message);
        }
        return {
            args: parsed.data,
            latencyMs: 1,
            remindersUsed: 0,
            tokenUsage: {
                inputTokens: 10,
                outputTokens: 5,
                model: options.model,
            },
        };
    }

    public shutdown(): Promise<void> {
        return Promise.resolve();
    }
}

async function exists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
