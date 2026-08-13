/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-floating-promises -- node:test registrations are intentionally top-level. */
/* eslint-disable @typescript-eslint/naming-convention -- Environment variable names are part of the executor contract. */

import {
    createBackendRegistry,
    createExecutorRegistry,
    loadBackendPlugin,
    loadExecutorPlugin,
    type ExecutorOptions,
    type Stimulus,
    type TrialIdentity,
    type TrialOptions,
} from '@microsoft/vally';
import assert from 'node:assert/strict';
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { CorEvaluationScenario } from '../src/scenario';
import type { SandboxValidationCommandResult } from '../src/SandboxProjectValidator';
import {
    type NativeAttemptRequest,
    type NativeAttemptRun,
    type NativeAttemptRunner,
    type AcaCommandRunner,
    CorAcaExperimentBackend,
    SpawnedNativeAttemptRunner,
    VallyAcaExecutor,
    VallyAcaTimeoutError,
    registerExecutors,
    resolveVallyAcaTrialSelection,
    sweepOwnedSandboxes,
    vallyAcaExperimentBackendName,
    vallyAcaExecutorName,
} from '../src/vallyAcaExecutor';
import type { AttemptEvidence, SummaryEvidence } from '../src/vally';
import {
    createVallyRunDiagnostics,
    renderVallyRunDiagnostics,
} from '../src/vallyRunDiagnostics';

const scratchRoot = path.resolve('evals/results/vally-aca-executor-test-work');
const scenario = makeScenario();
const authoritativeGateNames = [
    'planning',
    'scaffold',
    'build',
    'test',
    'integration',
    'local-runtime',
    'browser',
    'accessibility',
    'persistence',
    'worker',
    'debugger',
    'deployment',
    'security',
    'cleanup',
    'model',
    'provenance',
] as const;

describe('Vally ACA executor', () => {
    before(async () => {
        await fs.rm(scratchRoot, { recursive: true, force: true });
        await fs.mkdir(scratchRoot, { recursive: true });
    });

    after(async () => {
        await fs.rm(scratchRoot, { recursive: true, force: true });
    });

    test('requires and validates scenario, arm, endpoint, and model without defaults', () => {
        assert.throws(
            () => resolveVallyAcaTrialSelection(makeStimulus({ scenario: undefined }), {
                model: 'test-model',
                env: { COR_EVAL_ARM: 'rails', COR_EVAL_ENDPOINT: 'scaffold' },
            }, {}),
            /COR_EVAL_SCENARIO_ID/,
        );
        assert.throws(
            () => resolveVallyAcaTrialSelection(makeStimulus(), {
                model: 'test-model',
                env: { COR_EVAL_ARM: 'unknown', COR_EVAL_ENDPOINT: 'scaffold' },
            }, {}),
            /Unknown arm/,
        );
        assert.throws(
            () => resolveVallyAcaTrialSelection(makeStimulus(), {
                model: 'test-model',
                env: { COR_EVAL_ARM: 'rails', COR_EVAL_ENDPOINT: 'unknown' },
            }, {}),
            /Unknown endpoint/,
        );
        assert.throws(
            () => resolveVallyAcaTrialSelection(makeStimulus(), {
                model: 'test-model',
                env: { COR_EVAL_ARM: 'rails', COR_EVAL_ENDPOINT: 'deployment' },
            }, {}),
            /Unknown endpoint "deployment"/,
        );
        assert.throws(
            () => resolveVallyAcaTrialSelection(makeStimulus(), {
                env: { COR_EVAL_ARM: 'rails', COR_EVAL_ENDPOINT: 'scaffold' },
            }, {}),
            /COR_EVAL_MODEL/,
        );
    });

    test('resolves canonical tags before stimulus env and process env', () => {
        const fromTag = resolveVallyAcaTrialSelection(
            makeStimulus({
                arm: 'baseline-controlled',
                endpoint: 'local',
                model: 'test-model',
                environment: {
                    COR_EVAL_ARM: 'rails',
                    COR_EVAL_ENDPOINT: 'scaffold',
                    COR_EVAL_MODEL: 'other-model',
                },
            }),
            { model: 'test-model' },
            { COR_EVAL_ARM: 'rails', COR_EVAL_ENDPOINT: 'plan', COR_EVAL_MODEL: 'process-model' },
        );
        assert.equal(fromTag.arm, 'baseline-controlled');
        assert.equal(fromTag.endpoint, 'local');
        assert.equal(fromTag.scenarioId, scenario.id);

        const fromLegacyScenario = resolveVallyAcaTrialSelection(
            makeStimulus({
                scenario: undefined,
                legacyScenario: scenario.id,
                arm: 'rails',
                endpoint: 'scaffold',
                model: 'test-model',
            }),
            { model: 'test-model' },
            {},
        );
        assert.equal(fromLegacyScenario.scenarioId, scenario.id);
        assert.equal(
            resolveVallyAcaTrialSelection(
                makeStimulus({
                    legacyScenario: scenario.id,
                    arm: 'rails',
                    endpoint: 'scaffold',
                    model: 'test-model',
                }),
                { model: 'test-model' },
                {},
            ).scenarioId,
            scenario.id,
        );
        assert.throws(
            () => resolveVallyAcaTrialSelection(
                makeStimulus({
                    legacyScenario: 'conflicting-scenario',
                    arm: 'rails',
                    endpoint: 'scaffold',
                    model: 'test-model',
                }),
                { model: 'test-model' },
                {},
            ),
            /tag "scenarioId" conflicts with legacy tag "scenario"/,
        );

        const fromEnvironment = resolveVallyAcaTrialSelection(makeStimulus({
            scenario: undefined,
            environment: {
                COR_EVAL_SCENARIO_ID: scenario.id,
                COR_EVAL_ARM: 'rails',
                COR_EVAL_ENDPOINT: 'scaffold',
                COR_EVAL_MODEL: 'test-model',
            },
        }), {
            model: 'test-model',
        }, {});
        assert.equal(fromEnvironment.arm, 'rails');
        assert.equal(fromEnvironment.scenarioId, scenario.id);

        const fromProcess = resolveVallyAcaTrialSelection(
            makeStimulus({ scenario: undefined }),
            {},
            {
                COR_EVAL_SCENARIO_ID: scenario.id,
                COR_EVAL_ARM: 'rails',
                COR_EVAL_ENDPOINT: 'local',
                COR_EVAL_MODEL: 'test-model',
            },
        );
        assert.equal(fromProcess.endpoint, 'local');
        assert.equal(fromProcess.model, 'test-model');
        assert.throws(
            () => resolveVallyAcaTrialSelection(
                makeStimulus({ arm: 'baseline-controlled', endpoint: 'plan' }),
                { model: 'test-model' },
                {},
            ),
            /does not support the "plan" endpoint/,
        );
    });

    test('requires the durable executor artifact directory', async () => {
        const runner = new FakeRunner();
        const executor = makeExecutor(runner);
        await assert.rejects(
            executor.execute(
                makeStimulus({ arm: 'rails', endpoint: 'scaffold' }),
                makeOptions('missing-artifacts', {
                    sessionLog: {
                        rootDir: path.join(scratchRoot, 'session-log'),
                    },
                    env: { COR_EVAL_RELEASE_MODE: 'true' },
                }),
            ),
            /requires options\.sessionLog\.executorArtifactsDir/,
        );
        assert.equal(runner.requests.length, 0);
    });

    test('rejects an unknown scenario before invoking native execution', async () => {
        const runner = new FakeRunner();
        const executor = makeExecutor(runner);
        await assert.rejects(
            executor.execute(
                makeStimulus({
                    scenario: 'unknown-scenario',
                    arm: 'rails',
                    endpoint: 'scaffold',
                }),
                makeOptions('unknown-scenario'),
            ),
            /Unknown Copilot on Rails scenario "unknown-scenario"/,
        );
        assert.equal(runner.requests.length, 0);
    });

    test('runs exactly one native attempt and copies truthful artifacts and workspace', async () => {
        const runner = new FakeRunner();
        const executor = makeExecutor(runner);
        const options = makeOptions('successful');
        await fs.mkdir(options.workDir, { recursive: true });
        await fs.writeFile(path.join(options.workDir, 'stale.txt'), 'remove me');

        const stimulus = makeStimulus({ arm: 'rails', endpoint: 'scaffold' });
        const trajectory = await executor.execute(stimulus, options);

        assert.equal(runner.requests.length, 1);
        assert.equal(runner.requests[0].attempts, 1);
        assert.equal(runner.requests[0].concurrency, 1);
        assert.equal(runner.requests[0].scenarioId, scenario.id);
        assert.equal(runner.requests[0].model, 'test-model');
        assert.equal(runner.cleanupCount, 1);
        assert.equal(trajectory.stimulus.prompt, scenario.prompt);
        assert.equal(trajectory.stimulus.tags?.scenario, scenario.id);
        assert.equal(trajectory.stimulus.tags?.scenarioId, scenario.id);
        assert.equal(trajectory.stimulus.tags?.arm, 'rails');
        assert.equal(
            trajectory.stimulus.environment?.env?.COR_EVAL_SCENARIO_ID,
            scenario.id,
        );
        assert.equal(trajectory.workDir, options.workDir);
        assert.equal(trajectory.artifactDir, options.sessionLog?.executorArtifactsDir);
        assert.equal(trajectory.artifactDirStrict, true);
        assert.equal(trajectory.endReason, 'completed');
        assert.equal(trajectory.output, '');
        assert.equal(
            trajectory.events.some(event => event.type === 'assistant_message' || event.type === 'reasoning'),
            false,
        );
        assert.equal(trajectory.metrics.tokenUsage.inputTokens, 12);
        assert.equal(trajectory.events.filter(event => event.type === 'tool_call').length, 1);
        assert.equal(await fs.readFile(path.join(options.workDir, 'generated.txt'), 'utf8'), 'generated');
        await assert.rejects(fs.access(path.join(options.workDir, 'stale.txt')));

        const artifactDir = options.sessionLog?.executorArtifactsDir as string;
        await Promise.all([
            fs.access(path.join(artifactDir, 'native-summary.json')),
            fs.access(path.join(artifactDir, 'run-result.json')),
            fs.access(path.join(artifactDir, 'cor-validation.json')),
            fs.access(path.join(artifactDir, 'custom_metrics.json')),
            fs.access(path.join(artifactDir, 'adapter-metrics.json')),
            fs.access(path.join(artifactDir, 'validation-manifest.json')),
            fs.access(path.join(artifactDir, 'reports', 'run-diagnostics.json')),
            fs.access(path.join(artifactDir, 'reports', 'run-diagnostics.md')),
            fs.access(path.join(artifactDir, 'native', 'run-1', 'workspace', 'generated.txt')),
            fs.access(path.join(options.workDir, 'cor-validation.json')),
            fs.access(path.join(options.workDir, 'custom_metrics.json')),
            fs.access(path.join(options.workDir, 'validation-manifest.json')),
            fs.access(path.join(options.workDir, 'native-summary.json')),
            fs.access(path.join(options.workDir, 'run-result.json')),
            fs.access(path.join(options.workDir, 'adapter-metrics.json')),
        ]);
        const validation = JSON.parse(
            await fs.readFile(path.join(artifactDir, 'cor-validation.json'), 'utf8'),
        ) as { schema: string; provenance: Record<string, unknown> };
        const metrics = JSON.parse(
            await fs.readFile(path.join(artifactDir, 'custom_metrics.json'), 'utf8'),
        ) as { schema: string };
        assert.equal(validation.schema, 'copilot-on-rails-authoritative-validation/v1');
        assert.equal(metrics.schema, 'copilot-on-rails-authoritative-metrics/v1');
        assert.equal(validation.provenance.comparison, undefined);
        const manifest = JSON.parse(
            await fs.readFile(path.join(artifactDir, 'validation-manifest.json'), 'utf8'),
        ) as {
            ownerLabel: string;
            provenance: {
                candidateCommit: string;
                evaluationDefinition: { combinedHash: string };
            };
            validation: { cleanupVerified: boolean };
        };
        assert.equal(manifest.ownerLabel, runner.requests[0].env.COR_EVAL_OWNER_ID);
        assert.equal(manifest.provenance.candidateCommit, 'candidate-commit');
        assert.equal(manifest.provenance.evaluationDefinition.combinedHash, 'definition-hash');
        assert.equal(manifest.validation.cleanupVerified, true);
    });

    test('renders the primary command failure and distinguishes downstream checks not attempted', () => {
        const attempt: AttemptEvidence = {
            ...makeAttempt({}),
            outcome: 'failed',
            failedStage: 'local-runtime',
            failureCode: 'localTaskFailed',
            failureCategory: 'product_failure',
            error: 'Debug task "support-ticket-api: npm clean" failed.',
            agentRetries: 2,
        };
        attempt.stages.push({
            name: 'local-runtime',
            localRuntimeValidation: {
                outcome: 'failed',
                failureCode: 'localTaskFailed',
                error: attempt.error,
                commands: [{
                    kind: 'task',
                    name: 'support-ticket-api: npm clean',
                    command: 'npm run clean',
                    relativeDirectory: 'services/support-ticket-api',
                    success: false,
                    stdout: '> @support/api clean\n> rimraf dist',
                    stderr: [
                        'sh: 1: rimraf: not found',
                        'npm error code 127',
                        'npm error location /workspace/services/support-ticket-api',
                    ].join('\n'),
                }],
            },
        });
        const diagnostics = createVallyRunDiagnostics(attempt, {
            build: { status: 'passed', evidence: ['run-result.json'] },
            test: { status: 'passed', evidence: ['run-result.json'] },
            integration: { status: 'passed', evidence: ['run-result.json'] },
            'local-runtime': { status: 'failed', evidence: ['run-result.json'] },
            browser: {
                status: 'failed',
                evidence: ['missing applicable browser evidence in native-summary.json and run-result.json'],
            },
            accessibility: {
                status: 'failed',
                evidence: ['missing applicable accessibility evidence in native-summary.json and run-result.json'],
            },
            persistence: {
                status: 'failed',
                evidence: ['missing applicable persistence evidence in native-summary.json and run-result.json'],
            },
            debugger: {
                status: 'failed',
                evidence: ['missing applicable debugger evidence in native-summary.json and run-result.json'],
            },
        }, 2);

        assert.match(
            diagnostics.summary,
            /Build, Tests, and Integration passed after 2 repairs\./,
        );
        assert.match(diagnostics.summary, /Local runtime failed \(localTaskFailed\)/);
        assert.match(diagnostics.summary, /Required executable `rimraf` was unavailable/);
        assert.match(
            diagnostics.summary,
            /Browser, Accessibility, Persistence, and Debugger were not attempted\./,
        );
        assert.equal(
            diagnostics.gates.find(gate => gate.gate === 'browser')?.diagnosticStatus,
            'not-attempted',
        );
        assert.match(diagnostics.recommendedActions[0], /Declare and install `rimraf`/);
        assert.equal(diagnostics.failedCommand?.exitCode, 127);
        assert.equal(
            diagnostics.failedCommand?.workingDirectory,
            'services/support-ticket-api',
        );
        const markdown = renderVallyRunDiagnostics(diagnostics);
        assert.match(markdown, /## Failing command/);
        assert.match(markdown, /sh: 1: rimraf: not found/);
        assert.match(markdown, /\| browser \| not-attempted \|/);
    });

    test('keeps successful cleanup independent from a product failure', async () => {
        const runner = new FakeRunner({
            outcome: 'failed',
            failureCode: 'buildFailed',
            error: 'Generated project did not build.',
            validationCommands: [
                makeValidationCommand('npm run build', false),
            ],
        });
        const options = makeOptions('product-failure-cleanup');
        await makeExecutor(runner).execute(
            makeStimulus({ arm: 'rails', endpoint: 'scaffold' }),
            options,
        );

        const gates = await readAuthoritativeGates(options);
        const manifest = await readValidationManifest(
            options.sessionLog?.executorArtifactsDir as string,
        );
        const manifestValidation = manifest.validation as { cleanupVerified: boolean };
        assert.equal(gates.build.status, 'failed');
        assert.equal(gates.cleanup.status, 'passed');
        assert.equal(manifestValidation.cleanupVerified, true);
    });

    test('preserves the actual controlled baseline prompt in the trajectory', async () => {
        const runner = new FakeRunner();
        const executor = makeExecutor(runner);
        const trajectory = await executor.execute(
            makeStimulus({ arm: 'baseline-controlled', endpoint: 'local' }),
            makeOptions('baseline-prompt'),
        );
        assert.equal(trajectory.stimulus.prompt, scenario.baselinePrompt);
        assert.equal(
            trajectory.events.find(event => event.type === 'user_message')?.data.content,
            scenario.baselinePrompt,
        );
    });

    test('fails the applicable test gate when only build command evidence passed', async () => {
        const runner = new FakeRunner({
            validationCommands: [makeValidationCommand('npm run build')],
        });
        const options = makeOptions('build-only-evidence');
        await makeExecutor(runner).execute(
            makeStimulus({ arm: 'rails', endpoint: 'scaffold' }),
            options,
        );
        const gates = await readAuthoritativeGates(options);
        assert.equal(gates.build.status, 'passed');
        assert.equal(gates.test.status, 'failed');
        assert.match(gates.test.evidence?.[0] ?? '', /missing applicable test evidence/);
    });

    test('fails the applicable build gate when only test command evidence passed', async () => {
        const runner = new FakeRunner({
            validationCommands: [makeValidationCommand('npm test')],
        });
        const options = makeOptions('test-only-evidence');
        await makeExecutor(runner).execute(
            makeStimulus({ arm: 'rails', endpoint: 'scaffold' }),
            options,
        );
        const gates = await readAuthoritativeGates(options);
        assert.equal(gates.build.status, 'failed');
        assert.match(gates.build.evidence?.[0] ?? '', /missing applicable build evidence/);
        assert.equal(gates.test.status, 'passed');
    });

    test('fails project gates when validation stopped after partial command evidence', async () => {
        const runner = new FakeRunner({
            outcome: 'failed',
            failureCode: 'sandboxSetupFailed',
            error: 'The Python validation sandbox became unavailable.',
            validationFailureCode: 'sandboxSetupFailed',
            validationCommands: [
                makeValidationCommand('npm run build'),
                makeValidationCommand('npm test'),
            ],
        });
        const options = makeOptions('partial-validation-evidence');
        await makeExecutor(runner).execute(
            makeStimulus({ arm: 'rails', endpoint: 'scaffold' }),
            options,
        );
        const gates = await readAuthoritativeGates(options);
        assert.equal(gates.build.status, 'failed');
        assert.equal(gates.test.status, 'failed');
    });

    test('preserves passing debugger evidence when generated tests fail', async () => {
        const runner = new FakeRunner({
            outcome: 'failed',
            failureCode: 'sandboxCommandFailed',
            error: '.: "npm test" failed.',
            validationCommands: [
                makeValidationCommand('npm run build'),
                makeValidationCommand('npm test', false),
            ],
            includePassingDebuggerEvidence: true,
        });
        const options = makeOptions('test-failure-with-debugger-evidence');
        await makeExecutor(runner).execute(
            makeStimulus({
                arm: 'rails',
                endpoint: 'local',
                applicability: { debugger: 'required' },
            }),
            options,
        );
        const gates = await readAuthoritativeGates(options);
        assert.equal(gates.scaffold.status, 'passed');
        assert.equal(gates.build.status, 'passed');
        assert.equal(gates.test.status, 'failed');
        assert.equal(gates.integration.status, 'passed');
        assert.equal(gates['local-runtime'].status, 'passed');
        assert.equal(gates.debugger.status, 'passed');
    });

    test('fails Rails workflow gates when their required handoffs are missing', async () => {
        const runner = new FakeRunner({ omitHandoffs: true });
        const options = makeOptions('missing-rails-handoffs');
        await makeExecutor(runner).execute(
            makeStimulus({ arm: 'rails', endpoint: 'local' }),
            options,
        );
        const gates = await readAuthoritativeGates(options);
        assert.equal(gates.planning.status, 'failed');
        assert.equal(gates.scaffold.status, 'failed');
        assert.equal(gates.integration.status, 'failed');
        assert.equal(gates.build.status, 'passed');
        assert.equal(gates.test.status, 'passed');
    });

    test('only requires gates after their endpoint stage can run', async () => {
        const expected = {
            plan: {
                planning: true,
                scaffold: false,
                build: false,
                test: false,
                integration: false,
                ['local-runtime']: false,
                cleanup: false,
            },
            scaffold: {
                planning: true,
                scaffold: true,
                build: true,
                test: true,
                integration: false,
                ['local-runtime']: false,
                cleanup: true,
            },
            local: {
                planning: true,
                scaffold: true,
                build: true,
                test: true,
                integration: true,
                ['local-runtime']: true,
                cleanup: true,
            },
        } as const;
        for (const endpoint of ['plan', 'scaffold', 'local'] as const) {
            const options = makeOptions(`endpoint-applicability-${endpoint}`);
            await makeExecutor(new FakeRunner()).execute(
                makeStimulus({ arm: 'rails', endpoint }),
                options,
            );
            const applicability = await readAuthoritativeApplicability(options);
            for (const [gate, applicable] of Object.entries(expected[endpoint])) {
                assert.equal(applicability[gate], applicable, `${endpoint}:${gate}`);
            }
        }
        for (const endpoint of ['scaffold', 'local'] as const) {
            const options = makeOptions(`baseline-endpoint-applicability-${endpoint}`);
            await makeExecutor(new FakeRunner()).execute(
                makeStimulus({ arm: 'baseline-controlled', endpoint }),
                options,
            );
            const applicability = await readAuthoritativeApplicability(options);
            assert.equal(applicability.planning, false, `baseline:${endpoint}:planning`);
            assert.equal(
                applicability.integration,
                endpoint === 'local',
                `baseline:${endpoint}:integration`,
            );
        }
    });

    test('uses direct, neutral experiment, and baseline applicability declarations exactly', async () => {
        const cases = [
            {
                name: 'direct-rails',
                stimulus: makeStimulus({ arm: 'rails', endpoint: 'scaffold' }),
                planning: true,
            },
            {
                name: 'neutral-experiment-rails',
                stimulus: makeStimulus({
                    arm: 'rails',
                    endpoint: 'scaffold',
                    applicability: { planning: 'not-applicable' },
                }),
                planning: false,
            },
            {
                name: 'neutral-experiment-baseline',
                stimulus: makeStimulus({ arm: 'baseline-controlled', endpoint: 'scaffold' }),
                planning: false,
            },
        ];
        for (const item of cases) {
            const options = makeOptions(`declared-applicability-${item.name}`);
            await makeExecutor(new FakeRunner()).execute(item.stimulus, options);
            const applicability = await readAuthoritativeApplicability(options);
            assert.equal(applicability.planning, item.planning, item.name);
        }
    });

    test('fails closed on missing, invalid, and impossible applicability declarations', async () => {
        const cases = [
            {
                name: 'missing',
                stimulus: makeStimulus({
                    arm: 'rails',
                    endpoint: 'scaffold',
                    omitApplicabilityGate: 'security',
                }),
                error: /applicability-security.*must explicitly be/s,
            },
            {
                name: 'invalid',
                stimulus: makeStimulus({
                    arm: 'rails',
                    endpoint: 'scaffold',
                    applicability: { security: 'sometimes' },
                }),
                error: /applicability-security.*must explicitly be/s,
            },
            {
                name: 'impossible-deployment',
                stimulus: makeStimulus({
                    arm: 'rails',
                    endpoint: 'local',
                    applicability: { deployment: 'required' },
                }),
                error: /cannot require "deployment".*rails\/local/s,
            },
        ];
        for (const item of cases) {
            const runner = new FakeRunner();
            const options = makeOptions(`invalid-applicability-${item.name}`);
            await assert.rejects(makeExecutor(runner).execute(item.stimulus, options), item.error);
            assert.equal(runner.requests.length, 0);
            const manifest = await readValidationManifest(options.workDir);
            assert.equal((manifest as { status?: string }).status, 'failed');
        }
    });

    test('marks declared security applicable and fails on missing security evidence', async () => {
        const stimulus = makeStimulus({
            arm: 'rails',
            endpoint: 'scaffold',
            applicability: { security: 'required' },
        });
        const options = makeOptions('security-required');
        await makeExecutor(new FakeRunner()).execute(stimulus, options);
        const applicability = await readAuthoritativeApplicability(options);
        const gates = await readAuthoritativeGates(options);
        assert.equal(applicability.security, true);
        assert.equal(gates.security.status, 'failed');
        assert.match(gates.security.evidence?.[0] ?? '', /missing applicable security evidence/);

        const backendStimulus = makeBackendStimulus({
            arm: 'rails',
            endpoint: 'scaffold',
            applicability: { security: 'required' },
        });
        const backend = new CorAcaExperimentBackend({
            repoRoot: process.cwd(),
            stateRoot: path.join(scratchRoot, 'security-grader-integration'),
            executorFactory: () => makeExecutor(new FakeRunner()),
        });
        const trial = await backend.runTrial(
            makeTrialIdentity(backendStimulus),
            makeTrialOptionsWithGates(backendStimulus, [
                'planning',
                'scaffold',
                'build',
                'test',
                'security',
                'cleanup',
                'model',
                'provenance',
            ]),
        );
        assert.equal(trial.result.status, 'success');
        if (trial.result.status === 'success') {
            assert.equal(trial.result.gradeResult?.passed, false);
            const details = JSON.stringify(trial.result.gradeResult?.details);
            assert.match(details, /missing applicable security evidence/);
            assert.doesNotMatch(details, /applicability for security must/);
        }
        await trial.cleanup();
        await backend.shutdown();
    });

    test('rejects a native model mismatch and still performs owned cleanup', async () => {
        const runner = new FakeRunner({ observedModels: ['other-model'] });
        const executor = makeExecutor(runner);
        await assert.rejects(
            executor.execute(
                makeStimulus({ arm: 'rails', endpoint: 'scaffold' }),
                makeOptions('model-mismatch'),
            ),
            /observed a model other than "test-model"/,
        );
        assert.equal(runner.cleanupCount, 1);
        const options = makeOptions('model-mismatch');
        const [artifactManifest, workspaceManifest] = await Promise.all([
            readValidationManifest(options.sessionLog?.executorArtifactsDir as string),
            readValidationManifest(options.workDir),
        ]);
        assert.equal(artifactManifest.ownerLabel, runner.requests[0].env.COR_EVAL_OWNER_ID);
        assert.deepEqual(workspaceManifest, artifactManifest);
    });

    test('maps native failure truthfully without claiming completion', async () => {
        const runner = new FakeRunner({
            outcome: 'failed',
            failureCode: 'buildValidationFailed',
            error: 'isolated build failed',
        });
        const executor = makeExecutor(runner);
        const trajectory = await executor.execute(
            makeStimulus({ arm: 'rails', endpoint: 'scaffold' }),
            makeOptions('native-failure'),
        );
        assert.equal(trajectory.endReason, undefined);
        assert.equal(
            trajectory.events.some(event =>
                event.type === 'error' && event.data.message === 'isolated build failed'),
            true,
        );
        assert.equal(runner.cleanupCount, 1);
    });

    test('enforces the Vally hard timeout, aborts the owned attempt, and cleans it', async () => {
        const runner = new FakeRunner({ waitForAbort: true });
        const executor = makeExecutor(runner);
        await assert.rejects(
            executor.execute(
                makeStimulus({ arm: 'rails', endpoint: 'scaffold' }),
                makeOptions('timeout', { timeout: 10 }),
            ),
            (error: unknown) => error instanceof VallyAcaTimeoutError,
        );
        assert.equal(runner.aborted, true);
        assert.equal(runner.cleanupCount, 1);
        const manifest = JSON.parse(
            await fs.readFile(
                path.join(
                    makeOptions('timeout').sessionLog?.executorArtifactsDir as string,
                    'validation-manifest.json',
                ),
                'utf8',
            ),
        ) as { status: string; error: { code: string } };
        assert.equal(manifest.status, 'timed-out');
        assert.equal(manifest.error.code, 'COR_ACA_TIMEOUT');
    });

    test('registers direct executor and real experiment backend plugins', async () => {
        const directRegistry = createExecutorRegistry();
        registerExecutors(directRegistry);
        assert.equal(directRegistry.get(vallyAcaExecutorName)?.name, vallyAcaExecutorName);

        const loadedRegistry = createExecutorRegistry();
        await loadExecutorPlugin(
            path.resolve('evals/vally/plugins/aca-executor/index.js'),
            loadedRegistry,
        );
        assert.equal(loadedRegistry.get(vallyAcaExecutorName)?.name, vallyAcaExecutorName);

        const backendRegistry = createBackendRegistry();
        await loadBackendPlugin(
            path.resolve('evals/vally/plugins/aca-executor/backend.js'),
            backendRegistry,
        );
        const backend = backendRegistry.get(vallyAcaExperimentBackendName)?.create();
        assert.ok(backend instanceof CorAcaExperimentBackend);
        await backend.shutdown();
    });

    test('backend runs, grades with the authoritative registry, exports, and cleans idempotently', async () => {
        const runner = new FakeRunner();
        const backend = new CorAcaExperimentBackend({
            repoRoot: process.cwd(),
            stateRoot: path.join(scratchRoot, 'backend-state'),
            executorFactory: () => makeExecutor(runner),
        });
        await backend.prepare({}, {});
        const stimulus = makeBackendStimulus({ endpoint: 'scaffold' });
        const disposable = await backend.runTrial(
            makeTrialIdentity(stimulus),
            makeTrialOptions(stimulus),
        );
        assert.equal(disposable.result.status, 'success');
        if (disposable.result.status !== 'success') {
            return;
        }
        assert.equal(disposable.result.gradeResult?.passed, true);
        assert.equal(runner.requests[0].arm, 'rails');
        assert.equal(runner.requests[0].endpoint, 'scaffold');
        assert.equal(runner.requests[0].scenarioId, scenario.id);
        assert.equal(runner.requests[0].env.COR_EVAL_SCENARIO_ID, scenario.id);
        assert.equal(runner.requests[0].env.COR_EVAL_MODEL, 'test-model');
        assert.match(runner.requests[0].env.COR_EVAL_OWNER_ID, /^[a-z0-9][a-z0-9-]{0,62}$/);
        const exported = path.join(scratchRoot, 'backend-export');
        const manifest = await disposable.exportWorkspace?.({
            kind: 'artifacts',
            include: [
                'adapter-metrics.json',
                'cor-validation.json',
                'custom_metrics.json',
                'native-summary.json',
                'run-result.json',
                'validation-manifest.json',
            ],
        }, exported);
        assert.deepEqual(
            manifest?.files.sort(),
            [
                'adapter-metrics.json',
                'cor-validation.json',
                'custom_metrics.json',
                'native-summary.json',
                'run-result.json',
                'validation-manifest.json',
            ],
        );
        const exportedManifest = await readValidationManifest(exported);
        assert.equal(exportedManifest.ownerLabel, runner.requests[0].env.COR_EVAL_OWNER_ID);
        await disposable.cleanup();
        await disposable.cleanup();
        await assert.rejects(fs.access(disposable.result.workDir as string));
        await backend.shutdown();
        await backend.shutdown();
    });

    test('backend uses and preserves the host-owned durable executor artifact directory', async () => {
        const runner = new FakeRunner();
        const backend = new CorAcaExperimentBackend({
            repoRoot: process.cwd(),
            stateRoot: path.join(scratchRoot, 'backend-host-session'),
            executorFactory: () => makeExecutor(runner),
        });
        const stimulus = makeBackendStimulus({ endpoint: 'scaffold' });
        const options = { ...makeTrialOptions(stimulus), skipGrade: true };
        const hostRoot = path.join(scratchRoot, 'vally-host-session');
        const durableArtifacts = path.join(hostRoot, 'executor-artifacts');
        options.runOptions = {
            ...options.runOptions,
            sessionLog: {
                rootDir: hostRoot,
                sessionID: 'durable-host-session',
                executorArtifactsDir: durableArtifacts,
            },
        };
        const disposable = await backend.runTrial(makeTrialIdentity(stimulus), options);
        assert.equal(disposable.result.status, 'success');
        if (disposable.result.status !== 'success') {
            return;
        }
        assert.equal(disposable.result.trajectory.artifactDir, durableArtifacts);
        await disposable.cleanup();
        await fs.access(disposable.result.trajectory.artifactDir as string);
        await fs.access(path.join(durableArtifacts, 'cor-validation.json'));
        await backend.shutdown();
    });

    test('backend requires planner-safe authoritative tags before allocating a trial', async () => {
        const runner = new FakeRunner();
        const stateRoot = path.join(scratchRoot, 'backend-authoritative-contract');
        const backend = new CorAcaExperimentBackend({
            repoRoot: process.cwd(),
            stateRoot,
            executorFactory: () => makeExecutor(runner),
        });
        const missingMarker = makeStimulus({ endpoint: 'scaffold' });
        await assert.rejects(
            backend.runTrial(makeTrialIdentity(missingMarker), makeTrialOptions(missingMarker)),
            /backendAuthoritative/,
        );
        const missingApplicability = makeBackendStimulus({
            endpoint: 'scaffold',
            omitApplicabilityGate: 'build',
        });
        await assert.rejects(
            backend.runTrial(
                makeTrialIdentity(missingApplicability),
                makeTrialOptions(missingApplicability),
            ),
            /applicability-build/,
        );
        assert.equal(runner.requests.length, 0);
        await assert.rejects(fs.access(stateRoot));
        await backend.shutdown();
    });

    test('backend injects authoritative grading over planner-safe built-in metrics', async () => {
        const runner = new FakeRunner();
        const backend = new CorAcaExperimentBackend({
            repoRoot: process.cwd(),
            stateRoot: path.join(scratchRoot, 'backend-planner-safe-grading'),
            executorFactory: () => makeExecutor(runner),
        });
        const stimulus = makeBackendStimulus({
            arm: 'rails',
            endpoint: 'scaffold',
            applicability: { security: 'required' },
        });
        const options = makeTrialOptions(stimulus);
        options.graderConfigs = [{
            type: 'custom-metrics',
            config: {
                path: 'custom_metrics.json',
                assertions: [{ metric: 'authoritative_hard_gates_passed', equals: false }],
            },
        }];
        options.gradeOptions = {
            stimulus,
            weights: { 'custom-metrics': 1 },
        };
        const disposable = await backend.runTrial(makeTrialIdentity(stimulus), options);
        assert.equal(disposable.result.status, 'success');
        if (disposable.result.status === 'success') {
            assert.equal(disposable.result.gradeResult?.passed, false);
            assert.equal(disposable.result.gradeResult?.score, 0);
            const details = JSON.stringify(disposable.result.gradeResult?.details);
            assert.match(details, /backend-authoritative-release-hard-gates/);
            assert.match(details, /custom-metrics/);
            assert.match(details, /missing applicable security evidence/);
        }
        await disposable.cleanup();
        await backend.shutdown();
    });

    test('backend accepts a legacy scenario tag and rejects canonical conflicts before allocation', async () => {
        const runner = new FakeRunner();
        const stateRoot = path.join(scratchRoot, 'backend-scenario-tags');
        const backend = new CorAcaExperimentBackend({
            repoRoot: process.cwd(),
            stateRoot,
            executorFactory: () => makeExecutor(runner),
        });
        const legacyStimulus = makeBackendStimulus({
            scenario: undefined,
            legacyScenario: scenario.id,
            arm: 'rails',
            endpoint: 'scaffold',
        });
        const trial = await backend.runTrial(
            makeTrialIdentity(legacyStimulus),
            { ...makeTrialOptions(legacyStimulus), skipGrade: true },
        );
        assert.equal(runner.requests[0].scenarioId, scenario.id);
        await trial.cleanup();

        const conflictingStimulus = makeBackendStimulus({
            legacyScenario: 'conflicting-scenario',
            arm: 'rails',
            endpoint: 'scaffold',
        });
        await assert.rejects(
            backend.runTrial(
                makeTrialIdentity(conflictingStimulus),
                { ...makeTrialOptions(conflictingStimulus), skipGrade: true },
            ),
            /tag "scenarioId" conflicts with legacy tag "scenario"/,
        );
        assert.deepEqual(await fs.readdir(stateRoot), []);
        await backend.shutdown();
    });

    test('grades direct Rails, neutral experiment Rails, and baseline against exact declared gates', async () => {
        const runner = new FakeRunner();
        const backend = new CorAcaExperimentBackend({
            repoRoot: process.cwd(),
            stateRoot: path.join(scratchRoot, 'backend-exact-applicability'),
            executorFactory: () => makeExecutor(runner),
        });
        const commonGates = ['scaffold', 'build', 'test', 'cleanup', 'model', 'provenance'];
        const cases = [
            {
                name: 'direct',
                stimulus: makeBackendStimulus({ arm: 'rails', endpoint: 'scaffold' }),
                variant: 'rails',
                gates: ['planning', ...commonGates],
            },
            {
                name: 'neutral-rails',
                stimulus: makeBackendStimulus({
                    arm: 'rails',
                    endpoint: 'scaffold',
                    applicability: { planning: 'not-applicable' },
                }),
                variant: 'rails',
                gates: commonGates,
            },
            {
                name: 'baseline',
                stimulus: makeBackendStimulus({ arm: 'baseline-controlled', endpoint: 'scaffold' }),
                variant: 'baseline',
                gates: commonGates,
            },
        ];
        for (const item of cases) {
            const disposable = await backend.runTrial(
                {
                    ...makeTrialIdentity(item.stimulus),
                    id: `exact-${item.name}`,
                    variant: item.variant,
                },
                makeTrialOptionsWithGates(item.stimulus, item.gates),
            );
            assert.equal(disposable.result.status, 'success', item.name);
            if (disposable.result.status === 'success') {
                assert.equal(disposable.result.gradeResult?.passed, true, item.name);
            }
            await disposable.cleanup();
        }
        await backend.shutdown();
    });

    test('backend converts grader execution failures into a fail-closed synthetic grade', async () => {
        const runner = new FakeRunner();
        const backend = new CorAcaExperimentBackend({
            repoRoot: process.cwd(),
            stateRoot: path.join(scratchRoot, 'backend-grader-error'),
            executorFactory: () => makeExecutor(runner),
            graderRegistryFactory: () => {
                throw new Error('injected grader registry failure');
            },
        });
        const stimulus = makeBackendStimulus({ endpoint: 'scaffold' });
        const options = makeTrialOptions(stimulus);
        options.graderConfigs = [{ type: 'not-registered' }];
        const disposable = await backend.runTrial(makeTrialIdentity(stimulus), options);
        assert.equal(disposable.result.status, 'success');
        if (disposable.result.status === 'success') {
            assert.equal(disposable.result.gradeResult?.name, 'grader-error');
            assert.equal(disposable.result.gradeResult?.passed, false);
            assert.match(disposable.result.gradeResult?.evidence ?? '', /Grader execution error/);
        }
        await disposable.cleanup();
        await backend.shutdown();
    });

    test('backend isolates concurrent trials with unique work directories and owner labels', async () => {
        const runner = new FakeRunner();
        const backend = new CorAcaExperimentBackend({
            repoRoot: process.cwd(),
            stateRoot: path.join(scratchRoot, 'backend-concurrent'),
            executorFactory: () => makeExecutor(runner),
        });
        const stimulus = makeBackendStimulus({ endpoint: 'scaffold' });
        const [first, second] = await Promise.all([
            backend.runTrial(
                { ...makeTrialIdentity(stimulus), id: 'trial-a' },
                { ...makeTrialOptions(stimulus), skipGrade: true },
            ),
            backend.runTrial(
                { ...makeTrialIdentity(stimulus), id: 'trial-b' },
                { ...makeTrialOptions(stimulus), skipGrade: true },
            ),
        ]);
        assert.equal(first.result.status, 'success');
        assert.equal(second.result.status, 'success');
        assert.notEqual(first.result.workDir, second.result.workDir);
        assert.equal(new Set(runner.requests.map(request => request.env.COR_EVAL_OWNER_ID)).size, 2);
        await Promise.all([first.cleanup(), second.cleanup()]);
        await backend.shutdown();
    });

    test('backend scrubs its host trial directory and propagates executor cleanup failure', async () => {
        const runner = new FakeRunner();
        const backend = new CorAcaExperimentBackend({
            repoRoot: process.cwd(),
            stateRoot: path.join(scratchRoot, 'backend-cleanup-failure'),
            executorFactory: () => new ShutdownFailingExecutor(runner),
        });
        const stimulus = makeBackendStimulus({ endpoint: 'scaffold' });
        const disposable = await backend.runTrial(
            makeTrialIdentity(stimulus),
            { ...makeTrialOptions(stimulus), skipGrade: true },
        );
        assert.equal(disposable.result.status, 'success');
        const workDir = disposable.result.workDir as string;
        await assert.rejects(disposable.cleanup(), /injected executor shutdown failure/);
        await assert.rejects(fs.access(workDir));
        await backend.shutdown();
    });

    test('spawned runner sweeps the exact owner label after successful child execution', async () => {
        const outputDirectory = path.join(scratchRoot, 'spawned-success');
        await fs.mkdir(outputDirectory, { recursive: true });
        await fs.writeFile(path.join(outputDirectory, 'summary.json'), '{}\n');
        const aca = new FakeAcaRunner({ listStdout: '[]' });
        const runner = new SpawnedNativeAttemptRunner(aca, makeClosingSpawn(0));
        const request = makeNativeRequest(outputDirectory, 'success-child', 'cor-success-child');
        await runner.run(request);
        await runner.cleanup(request);
        assert.deepEqual(aca.calls, [
            ['sandbox', 'list', '-l', 'owner-id=cor-success-child', '-o', 'json'],
        ]);
    });

    test('spawned runner sweeps the exact owner label after a child omits its summary', async () => {
        const outputDirectory = path.join(scratchRoot, 'spawned-missing-summary');
        await fs.mkdir(outputDirectory, { recursive: true });
        const aca = new FakeAcaRunner();
        const runner = new SpawnedNativeAttemptRunner(aca, makeClosingSpawn(1));
        const request = makeNativeRequest(outputDirectory, 'crashed-child', 'cor-crashed-child');
        await assert.rejects(runner.run(request), /did not write summary\.json/);
        await runner.cleanup(request);
        assert.deepEqual(aca.calls, [
            ['sandbox', 'list', '-l', 'owner-id=cor-crashed-child', '-o', 'json'],
            ['sandbox', 'delete', '--id', 'sandbox-owned', '--yes'],
        ]);
    });

    test('timeout recovery only lists and deletes the exact trial owner label', async () => {
        const aca = new FakeAcaRunner();
        await sweepOwnedSandboxes(aca, 'cor-trial-123');
        assert.deepEqual(aca.calls, [
            ['sandbox', 'list', '-l', 'owner-id=cor-trial-123', '-o', 'json'],
            ['sandbox', 'delete', '--id', 'sandbox-owned', '--yes'],
        ]);
    });

    test('timeout recovery fails closed for invalid labels, list failures, and malformed JSON', async () => {
        const invalid = new FakeAcaRunner();
        await assert.rejects(
            sweepOwnedSandboxes(invalid, 'INVALID/LABEL'),
            /Invalid exact ACA sandbox owner label/,
        );
        assert.equal(invalid.calls.length, 0);

        const listFailure = new FakeAcaRunner({ listError: new Error('list unavailable') });
        await assert.rejects(
            sweepOwnedSandboxes(listFailure, 'cor-trial-123'),
            /Failed to list ACA sandboxes for exact owner label/,
        );

        const malformed = new FakeAcaRunner({ listStdout: '{not-an-array}' });
        await assert.rejects(
            sweepOwnedSandboxes(malformed, 'cor-trial-123'),
            /Failed to parse ACA sandbox list for exact owner label/,
        );
    });

    test('timeout recovery attempts every exact-label deletion and aggregates failures', async () => {
        const aca = new FakeAcaRunner({
            listStdout: JSON.stringify([{ id: 'sandbox-a' }, { id: 'sandbox-b' }]),
            deleteFailures: new Set(['sandbox-a', 'sandbox-b']),
        });
        await assert.rejects(
            sweepOwnedSandboxes(aca, 'cor-trial-aggregate'),
            error => error instanceof AggregateError
                && error.errors.length === 2
                && /Failed to delete 2 ACA sandbox/.test(error.message),
        );
        assert.deepEqual(aca.calls, [
            ['sandbox', 'list', '-l', 'owner-id=cor-trial-aggregate', '-o', 'json'],
            ['sandbox', 'delete', '--id', 'sandbox-a', '--yes'],
            ['sandbox', 'delete', '--id', 'sandbox-b', '--yes'],
        ]);
    });
});

interface FakeRunnerOptions {
    observedModels?: string[];
    outcome?: AttemptEvidence['outcome'];
    failureCode?: string;
    error?: string;
    waitForAbort?: boolean;
    validationCommands?: SandboxValidationCommandResult[];
    validationFailureCode?: string;
    includePassingDebuggerEvidence?: boolean;
    omitHandoffs?: boolean;
}

class FakeRunner implements NativeAttemptRunner {
    public readonly requests: NativeAttemptRequest[] = [];
    public cleanupCount = 0;
    public aborted = false;

    public constructor(private readonly options: FakeRunnerOptions = {}) {}

    public async run(request: NativeAttemptRequest): Promise<NativeAttemptRun> {
        this.requests.push(request);
        if (this.options.waitForAbort) {
            await new Promise<void>((_resolve, reject) => {
                request.signal.addEventListener('abort', () => {
                    this.aborted = true;
                    reject(request.signal.reason);
                }, { once: true });
            });
        }

        const attempt = makeAttempt(this.options);
        const summary = makeSummary(request, attempt);
        const resultDirectory = path.join(request.outputDirectory, attempt.runId);
        const workspace = path.join(resultDirectory, 'workspace');
        await fs.mkdir(workspace, { recursive: true });
        await Promise.all([
            fs.writeFile(path.join(request.outputDirectory, 'summary.json'), `${JSON.stringify(summary)}\n`),
            fs.writeFile(path.join(resultDirectory, 'run-result.json'), `${JSON.stringify(attempt)}\n`),
            fs.writeFile(path.join(workspace, 'generated.txt'), 'generated'),
        ]);
        return {
            outputDirectory: request.outputDirectory,
            summaryPath: path.join(request.outputDirectory, 'summary.json'),
        };
    }

    public async cleanup(_request: NativeAttemptRequest): Promise<void> {
        this.cleanupCount += 1;
    }
}

class ShutdownFailingExecutor extends VallyAcaExecutor {
    public constructor(runner: NativeAttemptRunner) {
        super({
            repoRoot: process.cwd(),
            runner,
            scenarioLoader: async () => [scenario],
        });
    }

    public override async shutdown(): Promise<void> {
        throw new Error('injected executor shutdown failure');
    }
}

function makeExecutor(runner: NativeAttemptRunner): VallyAcaExecutor {
    return new VallyAcaExecutor({
        repoRoot: process.cwd(),
        runner,
        scenarioLoader: async () => [scenario],
    });
}

function makeStimulus(overrides: {
    scenario?: string;
    legacyScenario?: string;
    arm?: string;
    endpoint?: string;
    model?: string;
    environment?: Record<string, string>;
    applicability?: Partial<Record<typeof authoritativeGateNames[number], string>>;
    omitApplicabilityGate?: typeof authoritativeGateNames[number];
    backendAuthoritative?: boolean;
} = {}): Stimulus {
    const tags: Record<string, string> = {};
    const scenarioId = Object.hasOwn(overrides, 'scenario') ? overrides.scenario : scenario.id;
    if (scenarioId !== undefined) {
        tags.scenarioId = scenarioId;
    }
    if (overrides.legacyScenario !== undefined) {
        tags.scenario = overrides.legacyScenario;
    }
    if (overrides.arm !== undefined) {
        tags.arm = overrides.arm;
    }
    if (overrides.endpoint !== undefined) {
        tags.endpoint = overrides.endpoint;
    }
    if (overrides.model !== undefined) {
        tags.model = overrides.model;
    }
    if (overrides.backendAuthoritative) {
        tags.backendAuthoritative = 'true';
    }
    const endpoint = overrides.endpoint ?? 'scaffold';
    const arm = overrides.arm ?? 'rails';
    const defaults: Record<typeof authoritativeGateNames[number], boolean> = {
        planning: arm === 'rails',
        scaffold: endpoint === 'scaffold' || endpoint === 'local',
        build: endpoint === 'scaffold' || endpoint === 'local',
        test: endpoint === 'scaffold' || endpoint === 'local',
        integration: endpoint === 'local',
        ['local-runtime']: endpoint === 'local',
        browser: false,
        accessibility: false,
        persistence: false,
        worker: false,
        debugger: false,
        deployment: false,
        security: false,
        cleanup: endpoint === 'scaffold' || endpoint === 'local',
        model: true,
        provenance: true,
    };
    for (const gate of authoritativeGateNames) {
        if (gate !== overrides.omitApplicabilityGate) {
            tags[`applicability-${gate}`] = overrides.applicability?.[gate]
                ?? (defaults[gate] ? 'required' : 'not-applicable');
        }
    }
    return {
        name: 'ACA executor trial',
        prompt: 'Execute the selected authoritative Copilot on Rails scenario.',
        tags,
        ...(overrides.environment
            ? { environment: { env: overrides.environment } }
            : {}),
    };
}

function makeBackendStimulus(
    overrides: Parameters<typeof makeStimulus>[0] = {},
): Stimulus {
    return makeStimulus({ ...overrides, backendAuthoritative: true });
}

function makeTrialIdentity(stimulus: Stimulus): TrialIdentity {
    return {
        id: 'trial-1',
        evalName: 'cor-test',
        evalFilePath: path.join(process.cwd(), 'evals', 'vally', 'native', 'canary.eval.yaml'),
        variant: 'rails',
        model: 'test-model',
        stimulus,
        trialIndex: 0,
        totalTrials: 1,
        retryEligible: false,
    };
}

function makeTrialOptions(stimulus: Stimulus): TrialOptions {
    return makeTrialOptionsWithGates(stimulus, [
        'planning',
        'scaffold',
        'build',
        'test',
        'cleanup',
        'model',
        'provenance',
    ]);
}

function makeTrialOptionsWithGates(stimulus: Stimulus, requiredGates: string[]): TrialOptions {
    return {
        runOptions: {
            prompt: stimulus.prompt,
            stimulusName: stimulus.name,
            stimulus,
            skills: [],
            workDir: process.cwd(),
            executor: makeExecutor(new FakeRunner()),
            timeout: 1_000,
            model: 'test-model',
        },
        graderConfigs: [{
            type: 'cor-authoritative',
            config: {
                requiredGates,
            },
        }],
        gradeOptions: { stimulus },
        skipGrade: false,
        context: {},
    };
}

function makeOptions(
    name: string,
    overrides: Partial<ExecutorOptions> = {},
): ExecutorOptions {
    const root = path.join(scratchRoot, name);
    return {
        timeout: 1_000,
        workDir: path.join(root, 'work'),
        model: 'test-model',
        sessionLog: {
            rootDir: path.join(root, 'session'),
            executorArtifactsDir: path.join(root, 'artifacts'),
        },
        ...overrides,
    };
}

function makeNativeRequest(
    outputDirectory: string,
    executionId: string,
    ownerLabel: string,
): NativeAttemptRequest {
    return {
        scenarioId: scenario.id,
        arm: 'rails',
        endpoint: 'scaffold',
        model: 'test-model',
        executionId,
        repoRoot: process.cwd(),
        outputDirectory,
        attempts: 1,
        concurrency: 1,
        env: { COR_EVAL_OWNER_ID: ownerLabel },
        signal: new AbortController().signal,
    };
}

function makeClosingSpawn(exitCode: number): typeof spawn {
    return ((_command: string, _args: readonly string[], _options: unknown) => {
        const child = Object.assign(new EventEmitter(), {
            exitCode: null,
            signalCode: null,
            kill: () => true,
        });
        queueMicrotask(() => child.emit('close', exitCode, null));
        return child;
    }) as unknown as typeof spawn;
}

function makeScenario(): CorEvaluationScenario {
    return {
        schemaVersion: '1',
        id: 'api-ts-functions-minimal',
        prompt: 'Create the Rails treatment project.',
        baselinePrompt: 'Create the controlled baseline project without any Rails-specific assets or custom tools.',
        tags: {
            archetype: 'api',
            frontend: 'none',
            backend: 'typescript-functions',
            database: 'none',
            auth: 'none',
            complexity: 'low',
        },
        validation: {
            profile: 'minimal',
            build: true,
            test: true,
            lint: 'if-present',
            timeoutMinutes: 5,
            maxAgentRetries: 0,
        },
    };
}

function makeAttempt(options: FakeRunnerOptions): AttemptEvidence {
    const validationCommands = options.validationCommands ?? [
        makeValidationCommand('npm run build'),
        makeValidationCommand('npm test'),
    ];
    const validationFailureCode = options.validationFailureCode
        ?? (validationCommands.some(command => !command.success) ? 'sandboxCommandFailed' : undefined);
    const attempt: AttemptEvidence = {
        schemaVersion: '1',
        evaluationArm: 'rails',
        runId: 'run-1',
        scenarioId: scenario.id,
        attempt: 1,
        outcome: options.outcome ?? 'autonomous_success',
        failureCode: options.failureCode,
        failureCategory: options.outcome === 'failed' ? 'product_failure' : undefined,
        error: options.error,
        candidateCommit: 'candidate-commit',
        agentAssetsHash: 'assets-hash',
        evaluationDefinition: {
            schemaVersion: '1',
            combinedHash: 'definition-hash',
            scenarioIds: [scenario.id],
            scenarioCorpusHash: 'scenarios-hash',
            evaluatorHash: 'evaluator-hash',
            productContractHash: 'product-contract-hash',
        },
        model: 'test-model',
        requestedModel: 'test-model',
        observedModels: options.observedModels ?? ['test-model'],
        durationMs: 25,
        agentRetries: 0,
        stages: [{
            name: 'plan',
            validation: { valid: true },
            gateCalled: !options.omitHandoffs,
            agentRun: {
                outcome: 'completed',
                sessionId: 'session-1',
                startedAt: '2026-08-07T10:00:00.000Z',
                completedAt: '2026-08-07T10:00:00.025Z',
                usage: {
                    apiCalls: 1,
                    inputTokens: 12,
                    outputTokens: 3,
                    reasoningTokens: 2,
                    cacheReadTokens: 4,
                    totalNanoAiu: 50,
                    models: options.observedModels ?? ['test-model'],
                },
                toolCalls: [{
                    toolCallId: 'tool-1',
                    toolName: 'view',
                    startedAt: '2026-08-07T10:00:00.010Z',
                    completedAt: '2026-08-07T10:00:00.020Z',
                    success: true,
                }],
                errors: [],
            },
        }, {
            name: 'scaffold',
            validation: { valid: true },
            gateCalled: !options.omitHandoffs,
            agentRun: {
                outcome: 'completed',
                sessionId: 'session-2',
                startedAt: '2026-08-07T10:00:00.000Z',
                completedAt: '2026-08-07T10:00:00.025Z',
                usage: {},
                toolCalls: [],
                errors: [],
            },
        }, {
            name: 'build',
            buildValidation: {
                outcome: validationFailureCode ? 'failed' : 'passed',
                failureCode: validationFailureCode,
                commands: validationCommands,
            } as unknown as { outcome?: string },
        }, {
            name: 'integration',
            validation: { valid: true },
            gateCalled: !options.omitHandoffs,
            agentRun: {
                outcome: 'completed',
                sessionId: 'session-3',
                startedAt: '2026-08-07T10:00:00.000Z',
                completedAt: '2026-08-07T10:00:00.025Z',
                usage: {},
                toolCalls: [],
                errors: [],
            },
        }],
    };
    if (options.includePassingDebuggerEvidence) {
        attempt.stages.push({
            name: 'local-runtime',
            localRuntimeValidation: {
                outcome: 'passed',
                commands: [{
                    kind: 'debugger',
                    name: 'attach and hit breakpoint',
                    success: true,
                }],
            },
        });
    }
    return attempt;
}

async function readAuthoritativeGates(
    options: ExecutorOptions,
): Promise<Record<string, { status: string; evidence?: string[] }>> {
    const artifactDir = options.sessionLog?.executorArtifactsDir as string;
    const validation = JSON.parse(
        await fs.readFile(path.join(artifactDir, 'cor-validation.json'), 'utf8'),
    ) as { gates: Record<string, { status: string; evidence?: string[] }> };
    return validation.gates;
}

async function readValidationManifest(
    directory: string,
): Promise<{ ownerLabel: string; [key: string]: unknown }> {
    return JSON.parse(
        await fs.readFile(path.join(directory, 'validation-manifest.json'), 'utf8'),
    ) as { ownerLabel: string; [key: string]: unknown };
}

async function readAuthoritativeApplicability(
    options: ExecutorOptions,
): Promise<Record<string, boolean>> {
    const artifactDir = options.sessionLog?.executorArtifactsDir as string;
    const validation = JSON.parse(
        await fs.readFile(path.join(artifactDir, 'cor-validation.json'), 'utf8'),
    ) as { applicability: Record<string, boolean> };
    return validation.applicability;
}

function makeValidationCommand(command: string, success = true): SandboxValidationCommandResult {
    return {
        ecosystem: 'node',
        relativeDirectory: '.',
        command,
        success,
        failureKind: success ? undefined : 'commandExit',
        durationMs: 1,
        stdout: '',
        stderr: '',
    };
}

function makeSummary(
    request: NativeAttemptRequest,
    attempt: AttemptEvidence,
): SummaryEvidence & { attempts: number; concurrency: number } {
    attempt.evaluationArm = request.arm;
    return {
        schemaVersion: '1',
        evaluationArm: request.arm,
        startedAt: '2026-08-07T10:00:00.000Z',
        completedAt: '2026-08-07T10:00:00.025Z',
        candidateCommit: 'candidate-commit',
        agentAssetsHash: request.arm === 'rails'
            ? 'assets-hash'
            : 'not-applicable:baseline-controlled',
        evaluationDefinitions: attempt.evaluationDefinition ? [attempt.evaluationDefinition] : [],
        through: request.endpoint,
        requestedModel: request.model,
        requestedModels: [request.model],
        observedModels: attempt.observedModels,
        results: [attempt],
        attempts: 1,
        concurrency: 1,
    };
}

interface FakeAcaRunnerOptions {
    listStdout?: string;
    listError?: Error;
    deleteFailures?: Set<string>;
}

class FakeAcaRunner implements AcaCommandRunner {
    public readonly calls: string[][] = [];

    public constructor(private readonly options: FakeAcaRunnerOptions = {}) {}

    public async run(args: string[], _timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
        this.calls.push(args);
        if (args[1] === 'list' && this.options.listError) {
            throw this.options.listError;
        }
        if (args[1] === 'delete') {
            const id = args[args.indexOf('--id') + 1];
            if (this.options.deleteFailures?.has(id)) {
                throw new Error(`delete failed: ${id}`);
            }
        }
        return {
            stdout: args[1] === 'list'
                ? this.options.listStdout ?? JSON.stringify([{ id: 'sandbox-owned' }])
                : '',
            stderr: '',
        };
    }
}
