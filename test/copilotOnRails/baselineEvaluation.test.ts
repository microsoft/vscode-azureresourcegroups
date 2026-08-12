/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { CorAgentRunResult } from '../../src/utils/copilotOnRails/agentExecution/CorAgentExecutor';
import {
    createBaselineClientOptions,
    createBaselineSessionConfig,
    baselineAvailableTools,
    baselineSystemMessage,
    isBaselineFilePermissionAllowed,
} from '../../evals/src/BaselineCopilotSdkExecutor';
import { isTreatmentPermissionAllowed } from '../../evals/src/CopilotSdkAgentExecutor';
import {
    BaselineScenario,
    createLocalPlanMetadata,
    parseBaselineArgs,
    runBaselineAttempt,
} from '../../evals/src/baseline';
import { parsePlannedConfigurations } from '../../evals/src/SandboxLocalRuntimeValidator';
import {
    EvaluationAttempt,
    EvaluationSummary,
    createReport,
    renderMarkdown,
} from '../../evals/src/report';
import {
    CorEvaluationScenario,
    loadScenarios,
    validateScenario,
} from '../../evals/src/scenario';
import { parseResumeArgs } from '../../evals/src/resumeLocal';
import { parseRunArgs } from '../../evals/src/run';

const repoRoot = path.resolve(__dirname, '..', '..');
const scenarioDirectory = path.join(repoRoot, 'evals', 'scenarios');
const testResultsRoot = path.join(repoRoot, 'evals', 'results');
const model = 'test-model';

suite('Controlled baseline evaluation', () => {
    test('requires standalone baseline prompts and validates all twenty corpus prompts', async () => {
        const scenario = createScenario();
        const missing = { ...scenario } as Partial<CorEvaluationScenario>;
        delete missing.baselinePrompt;
        assert.throws(
            () => validateScenario(missing, 'missing-baseline.json'),
            /baselinePrompt must be a standalone prompt/,
        );
        assert.throws(
            () => validateScenario({ ...scenario, baselinePrompt: '   ' }, 'empty-baseline.json'),
            /baselinePrompt must be a standalone prompt/,
        );

        const scenarios = await loadScenarios(scenarioDirectory);
        assert.equal(scenarios.length, 20);
        const prohibited = /\b(?:evaluator|webview|handoff|skills?|custom agents?)\b|copilot[- ]on[- ]rails|baseline-controlled|\.azure\/|(?:project|deployment|vscode-debug)-plan\.md|open_(?:requirements|plan)/i;
        for (const corpusScenario of scenarios) {
            assert(
                corpusScenario.baselinePrompt.trim().length >= 100,
                `${corpusScenario.id} needs a standalone baselinePrompt.`,
            );
            assert.doesNotMatch(
                corpusScenario.baselinePrompt,
                prohibited,
                `${corpusScenario.id} leaks treatment or evaluation details.`,
            );
        }
    });

    test('pins real runs to an explicit model while keeping dry-run model-free', () => {
        assert.throws(() => parseBaselineArgs([]), /--model is required/);
        assert.equal(parseBaselineArgs(['--dry-run']).model, undefined);
        assert.equal(parseBaselineArgs(['--model', model]).model, model);
        assert.throws(() => parseRunArgs([]), /--model is required/);
        assert.equal(parseRunArgs(['--dry-run']).model, undefined);
        assert.equal(parseRunArgs(['--model', model]).model, model);
        assert.throws(
            () => parseResumeArgs(['--workspace', '.', '--scenario', 'scenario', '--output', 'output']),
            /--model are required/,
        );
        assert.equal(
            parseResumeArgs([
                '--workspace', '.',
                '--scenario', 'scenario',
                '--output', 'output',
                '--model', model,
            ]).model,
            model,
        );
    });

    test('uses empty-mode generic Copilot with only workspace file tools', () => {
        const request = {
            prompt: 'Build the project.',
            workingDirectory: path.join(testResultsRoot, 'candidate'),
            model,
            timeoutMs: 1_000,
        };
        const client = createBaselineClientOptions(request);
        const session = createBaselineSessionConfig(request);
        assert.equal(client.mode, 'empty');
        assert.equal(client.workingDirectory, request.workingDirectory);
        assert.notEqual(client.baseDirectory, request.workingDirectory);
        assert.equal(session.model, model);
        assert.deepEqual(session.availableTools, baselineAvailableTools);
        assert.deepEqual(session.customAgents, []);
        assert.deepEqual(session.skillDirectories, []);
        assert.deepEqual(session.pluginDirectories, []);
        assert.deepEqual(session.mcpServers, {});
        assert.equal(session.enableConfigDiscovery, false);
        assert.equal(session.enableMcpApps, false);
        assert.equal(session.requestCanvasRenderer, false);
        assert.equal(session.requestExtensions, false);
        assert.equal(session.skipCustomInstructions, true);
        assert.equal(session.workingDirectory, request.workingDirectory);
        assert.deepEqual(session.tools, undefined);
        assert.deepEqual(session.agent, undefined);
        assert.doesNotMatch(baselineSystemMessage, /rails|webview|handoff|evaluator/i);
        assert.match(baselineSystemMessage, /Do not use shell, network, MCP, delegation, custom agents, skills/);
        assert.equal(
            isBaselineFilePermissionAllowed({ kind: 'read', path: 'src/index.ts' }, request.workingDirectory),
            true,
        );
        assert.equal(
            isBaselineFilePermissionAllowed({ kind: 'write', fileName: '../outside.ts' }, request.workingDirectory),
            false,
        );
        assert.equal(
            isBaselineFilePermissionAllowed({
                kind: 'read',
                path: 'src/index.ts',
                requestSandboxBypass: true,
            }, request.workingDirectory),
            false,
        );
        assert.equal(
            isBaselineFilePermissionAllowed({ kind: 'custom-tool' }, request.workingDirectory),
            false,
        );
    });

    test('allows managed treatment file tools only inside the workspace', () => {
        const workspace = path.join(testResultsRoot, 'candidate');
        const allowed = [
            { kind: 'read', path: 'src/index.ts', managedApprovalRequired: true },
            { kind: 'read', path: path.join(workspace, 'src', 'index.ts') },
            { kind: 'read', directory: 'src' },
            { kind: 'write', fileName: 'src/index.ts', managedApprovalRequired: true },
            { kind: 'write', fileName: path.join(workspace, 'src', 'index.ts') },
            { kind: 'custom-tool', toolName: 'open_requirements_view' },
        ];
        for (const permission of allowed) {
            assert.equal(
                isTreatmentPermissionAllowed(permission, workspace),
                true,
                `Expected ${JSON.stringify(permission)} to be allowed.`,
            );
        }

        const rejected = [
            { kind: 'read', path: '../outside.ts' },
            { kind: 'read', directory: path.resolve(workspace, '..') },
            { kind: 'write', fileName: path.join(workspace, '..', 'outside.ts') },
            { kind: 'read', path: 'src/index.ts', requestSandboxBypass: true },
            { kind: 'write', fileName: 'src/index.ts', requestSandboxBypass: true },
            { kind: 'read', managedApprovalRequired: true },
            { kind: 'shell', fullCommandText: 'pwd', managedApprovalRequired: true },
            { kind: 'url', url: 'https://example.com' },
            { kind: 'mcp', serverName: 'example', toolName: 'read' },
        ];
        for (const permission of rejected) {
            assert.equal(
                isTreatmentPermissionAllowed(permission, workspace),
                false,
                `Expected ${JSON.stringify(permission)} to be rejected.`,
            );
        }
    });

    test('allows canonical treatment paths when the workspace root is a symlink alias', async () => {
        await withProjectScratch(async scratch => {
            const canonicalParent = path.join(scratch, 'canonical');
            const canonicalWorkspace = path.join(canonicalParent, 'workspace');
            const aliasedParent = path.join(scratch, 'alias');
            await fs.mkdir(canonicalWorkspace, { recursive: true });
            await fs.symlink(canonicalParent, aliasedParent, process.platform === 'win32' ? 'junction' : 'dir');

            const existingFile = path.join(canonicalWorkspace, 'existing.ts');
            await fs.writeFile(existingFile, '');
            const aliasedWorkspace = path.join(aliasedParent, 'workspace');
            assert.equal(
                isTreatmentPermissionAllowed({ kind: 'read', path: existingFile }, aliasedWorkspace),
                true,
            );
            assert.equal(
                isTreatmentPermissionAllowed({
                    kind: 'write',
                    fileName: path.join(canonicalWorkspace, 'new', 'file.ts'),
                }, aliasedWorkspace),
                true,
            );

            const outside = path.join(scratch, 'outside');
            await fs.mkdir(outside);
            await fs.writeFile(path.join(outside, 'outside.ts'), '');
            await fs.symlink(
                outside,
                path.join(canonicalWorkspace, 'outside-alias'),
                process.platform === 'win32' ? 'junction' : 'dir',
            );
            assert.equal(
                isTreatmentPermissionAllowed({
                    kind: 'read',
                    path: path.join(canonicalWorkspace, 'outside-alias', 'outside.ts'),
                }, aliasedWorkspace),
                false,
            );
            assert.equal(
                isTreatmentPermissionAllowed({
                    kind: 'write',
                    fileName: path.join(canonicalWorkspace, 'outside-alias', 'new.ts'),
                }, aliasedWorkspace),
                false,
            );
        });
    });

    test('adapts generated VS Code launch artifacts without creating a Rails plan', async () => {
        await withProjectScratch(async scratch => {
            const workspace = path.join(scratch, 'workspace');
            await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
            const workspaceFolder = '$' + '{workspaceFolder}';
            await fs.writeFile(path.join(workspace, '.vscode', 'launch.json'), `{
                // JSONC is accepted because VS Code emits it.
                "configurations": [
                    {
                        "name": "Tickets API",
                        "type": "pwa-node",
                        "cwd": "${workspaceFolder}/services/api",
                    },
                    {
                        "name": "Tickets Frontend",
                        "type": "pwa-chrome",
                        "cwd": "${workspaceFolder}/services/web",
                    },
                ],
            }`);
            const scenario = createScenario({
                acceptance: {
                    local: {
                        probes: [
                            {
                                name: 'API health',
                                target: 'backend' as const,
                                method: 'GET',
                                url: 'http://127.0.0.1:7071/health',
                                expectedStatus: 200,
                            },
                            {
                                name: 'Frontend',
                                target: 'frontend',
                                method: 'GET',
                                url: 'http://127.0.0.1:5173/',
                                expectedStatus: 200,
                            },
                        ],
                    },
                },
            });

            const metadata = await createLocalPlanMetadata(workspace, scenario);
            const configurations = parsePlannedConfigurations(metadata);
            assert.deepEqual(configurations, [
                {
                    name: 'Tickets API',
                    serviceRoot: 'services/api',
                    projectType: 'Backend',
                    runtime: 'Node.js',
                },
                {
                    name: 'Tickets Frontend',
                    serviceRoot: 'services/web',
                    projectType: 'Frontend',
                    runtime: 'Node.js',
                },
            ]);
            await assert.rejects(
                fs.stat(path.join(workspace, '.azure', 'vscode-debug-plan.md')),
                { code: 'ENOENT' },
            );
        });
    });

    test('runs an injected baseline attempt without loading treatment assets or calling a model', async () => {
        await withProjectScratch(async scratch => {
            const requests: string[] = [];
            const input = await createAttemptInput(scratch, {
                executor: {
                    run: async request => {
                        requests.push(request.prompt);
                        return completedRun(model);
                    },
                },
            });
            const result = await runBaselineAttempt(input);
            assert.equal(result.outcome, 'autonomous_success');
            assert.equal(result.evaluationArm, 'baseline-controlled');
            assert.equal(result.agentAssetsHash, 'not-applicable:baseline-controlled');
            assert.equal(result.requestedModel, model);
            assert.deepEqual(result.observedModels, [model]);
            assert.equal(result.sourceProvenance.railsAssetsInjected, false);
            assert.equal(result.sourceProvenance.customToolsInjected, false);
            assert.deepEqual(requests, [input.scenario.baselinePrompt]);
            assert.deepEqual(result.stages.map(stage => stage.name), ['scaffold', 'build']);
            await assert.rejects(
                fs.stat(path.join(input.outputDirectory, result.runId, 'workspace', '.github', 'agents')),
                { code: 'ENOENT' },
            );
        });
    });

    test('continues to local runtime after generated tests fail', async () => {
        await withProjectScratch(async scratch => {
            let validationCalls = 0;
            let localRuntimeCalls = 0;
            const input = await createAttemptInput(scratch, {
                through: 'local',
                projectValidator: {
                    validate: async () => {
                        validationCalls++;
                        return failedTestValidation();
                    },
                },
                localRuntimeValidator: {
                    validate: async () => {
                        localRuntimeCalls++;
                        return {
                            outcome: 'passed',
                            commands: [],
                            probes: [],
                        };
                    },
                },
            });

            const result = await runBaselineAttempt(input);
            assert.equal(result.outcome, 'failed');
            assert.equal(result.failureCode, 'sandboxCommandFailed');
            assert.equal(validationCalls, 2);
            assert.equal(localRuntimeCalls, 1);
            assert.equal(result.stages.some(stage => stage.name === 'local-runtime'), true);
            assert.equal(result.qualityFailures?.[0].code, 'sandboxCommandFailed');
        });
    });

    test('keeps a later local failure primary after continuing past failed tests', async () => {
        await withProjectScratch(async scratch => {
            const input = await createAttemptInput(scratch, {
                through: 'local',
                projectValidator: {
                    validate: async () => failedTestValidation(),
                },
                localRuntimeValidator: {
                    validate: async () => ({
                        outcome: 'failed',
                        failureCode: 'localProbeFailed',
                        error: 'The generated API did not answer its health probe.',
                        commands: [],
                        probes: [],
                    }),
                },
            });

            const result = await runBaselineAttempt(input);
            assert.equal(result.failedStage, 'local-runtime');
            assert.equal(result.failureCode, 'localProbeFailed');
            assert.equal(result.qualityFailures?.[0].code, 'sandboxCommandFailed');
            assert.match(result.error ?? '', /Earlier quality failure/);
        });
    });

    test('fails closed when the observed model does not match the pin', async () => {
        await withProjectScratch(async scratch => {
            let validationCalls = 0;
            const input = await createAttemptInput(scratch, {
                executor: { run: async () => completedRun('different-model') },
                projectValidator: {
                    validate: async () => {
                        validationCalls++;
                        return { outcome: 'passed', commands: [] };
                    },
                },
            });
            const result = await runBaselineAttempt(input);
            assert.equal(result.outcome, 'failed');
            assert.equal(result.failureCode, 'modelMismatch');
            assert.equal(result.failureCategory, 'harness_failure');
            assert.deepEqual(result.observedModels, ['different-model']);
            assert.equal(validationCalls, 0);
        });
    });

    test('fails closed when no model usage is observed', async () => {
        await withProjectScratch(async scratch => {
            const run = completedRun(model);
            run.usage.models = [];
            const input = await createAttemptInput(scratch, {
                executor: { run: async () => run },
            });
            const result = await runBaselineAttempt(input);
            assert.equal(result.outcome, 'failed');
            assert.equal(result.failureCode, 'modelNotObserved');
            assert.equal(result.failureCategory, 'harness_failure');
            assert.deepEqual(result.observedModels, []);
        });
    });

    test('enforces one shared repair budget and records sanitized repair provenance', async () => {
        await withProjectScratch(async scratch => {
            const prompts: string[] = [];
            const input = await createAttemptInput(scratch, {
                executor: {
                    run: async request => {
                        prompts.push(request.prompt);
                        return completedRun(model);
                    },
                },
                projectValidator: {
                    validate: async () => ({
                        outcome: 'failed',
                        failureCode: 'noBuildTargets',
                        error: 'password=super-secret',
                        commands: [],
                    }),
                },
            });
            const result = await runBaselineAttempt(input);
            assert.equal(result.outcome, 'failed');
            assert.equal(result.failureCode, 'noBuildTargets');
            assert.equal(result.failureCategory, 'product_failure');
            assert.equal(result.agentRetries, 1);
            assert.equal(prompts.length, 2);
            assert.match(prompts[1], /Repair attempt 1/);
            assert.match(prompts[1], /password=\[REDACTED\]/);
            assert.doesNotMatch(prompts[1], /\bevaluator\b|copilot[- ]on[- ]rails/i);
            assert.deepEqual(
                result.stages.map(stage => stage.name),
                ['scaffold', 'build', 'repair', 'build'],
            );
            assert.equal(result.sourceProvenance.promptField, 'baselinePrompt');
        });
    });

    test('reports exact paired outcomes, exclusions, recovery, and unmatched evidence', () => {
        const scenario = createScenario();
        const candidate = createCandidateSummary([
            attempt('candidate-1', 1, 'autonomous_success'),
            attempt('candidate-2', 2, 'failed', { failureCategory: 'product_failure' }),
            attempt('candidate-3', 3, 'autonomous_success', { agentRetries: 1 }),
            attempt('candidate-4', 4, 'failed', { failureCategory: 'harness_failure' }),
            attempt('candidate-5', 5, 'autonomous_success'),
        ]);
        const baseline = createBaselineSummary([
            attempt('baseline-1', 1, 'failed', { failureCategory: 'product_failure' }),
            attempt('baseline-2', 2, 'autonomous_success'),
            attempt('baseline-3', 3, 'autonomous_success'),
            attempt('baseline-4', 4, 'failed', { failureCategory: 'product_failure' }),
            attempt('baseline-6', 6, 'failed', { failureCategory: 'product_failure' }),
        ]);

        const comparison = createReport([candidate], [scenario], [baseline]).baselineComparison;
        assert(comparison);
        assert.equal(comparison.matchedAttempts, 4);
        assert.equal(comparison.unmatchedCandidateAttempts, 1);
        assert.equal(comparison.unmatchedBaselineAttempts, 1);
        assert.equal(comparison.allAutonomous.railsOnlyWins, 1);
        assert.equal(comparison.allAutonomous.baselineOnlyWins, 1);
        assert.equal(comparison.allAutonomous.bothPass, 1);
        assert.equal(comparison.allAutonomous.bothFail, 1);
        assert.equal(comparison.allAutonomous.candidateFirstPass.successes, 1);
        assert.equal(comparison.allAutonomous.baselineFirstPass.successes, 2);
        assert.equal(comparison.allAutonomous.candidateRecoveredSuccesses, 1);
        assert.equal(comparison.productQuality.excludedPairs, 1);
        assert.equal(comparison.productQuality.candidateExcludedAttempts, 1);
        assert.equal(comparison.productQuality.baselineExcludedAttempts, 0);
        assert.equal(comparison.productQuality.matchedAttempts, 3);
        assert.throws(
            () => createReport([createCandidateSummary([
                attempt('duplicate-1', 1, 'autonomous_success'),
                attempt('duplicate-2', 1, 'autonomous_success'),
            ])], [scenario], [createBaselineSummary([
                attempt('baseline', 1, 'autonomous_success'),
            ])]),
            /Ambiguous candidate pairing key/,
        );
    });

    test('validates arms and paired models while exposing legacy provenance', () => {
        const scenario = createScenario();
        const value = attempt('candidate', 1, 'autonomous_success');
        const candidate = createCandidateSummary([value]);
        const baseline = createBaselineSummary([attempt('baseline', 1, 'autonomous_success')]);
        assert.throws(
            () => createReport([{ ...candidate, evaluationArm: 'baseline-controlled' }], [scenario], [baseline]),
            /Candidate report inputs must use evaluationArm "rails"/,
        );
        assert.throws(
            () => createReport([candidate], [scenario], [{ ...baseline, evaluationArm: 'rails' }]),
            /Baseline report inputs must use evaluationArm "baseline-controlled"/,
        );
        assert.throws(
            () => createReport([{
                ...candidate,
                results: [{ ...candidate.results[0], evaluationArm: 'baseline-controlled' }],
            }], [scenario], [baseline]),
            /Candidate attempt "candidate" must use evaluationArm "rails"/,
        );
        assert.throws(
            () => createReport([{
                ...candidate,
                results: [{ ...candidate.results[0], evaluationArm: undefined }],
            }], [scenario], [baseline]),
            /is missing evaluationArm under a declared "rails" summary/,
        );
        assert.throws(
            () => createReport([candidate], [scenario], [{
                ...baseline,
                results: [{ ...baseline.results[0], requestedModel: 'other-model', model: 'other-model' }],
            }]),
            /requested different models/,
        );
        assert.throws(
            () => createReport([candidate], [scenario], [{
                ...baseline,
                candidateCommit: 'different-candidate',
            }]),
            /candidate commit mismatch/,
        );

        const legacyCandidate: EvaluationSummary = {
            ...candidate,
            evaluationArm: undefined,
            results: candidate.results.map(result => ({ ...result, evaluationArm: undefined })),
        };
        const legacyBaseline: EvaluationSummary = {
            ...baseline,
            evaluationArm: undefined,
            results: baseline.results.map(result => ({ ...result, evaluationArm: undefined })),
        };
        const legacyComparison = createReport(
            [legacyCandidate],
            [scenario],
            [legacyBaseline],
        ).baselineComparison;
        assert(legacyComparison);
        assert.equal(legacyComparison.armProvenance.candidate.provenance, 'legacy_missing');
        assert.equal(legacyComparison.armProvenance.baseline.provenance, 'legacy_missing');

        const noBaseline = createReport([legacyCandidate], [scenario], []);
        assert.equal(noBaseline.baselineComparison, undefined);
        assert.equal(noBaseline.autonomousOutcome.successes, 1);
    });

    test('binds live deployment evidence to an exact local treatment attempt', () => {
        const scenario = createScenario();
        const sourceAttempt = attempt('source-run', 1, 'autonomous_success', {
            candidateCommit: 'candidate',
            agentAssetsHash: 'assets',
        });
        const candidate = {
            ...createCandidateSummary([sourceAttempt]),
            through: 'local',
        };
        const deployment = {
            outcome: 'passed' as const,
            runId: 'deployment-run',
            environmentName: 'cor-eval-deployment',
            resourceGroup: 'cor-eval-deployment',
            commands: [],
            cleanupVerified: true,
            sourceProvenance: {
                evaluationArm: 'rails' as const,
                through: 'local' as const,
                runId: sourceAttempt.runId,
                scenarioId: sourceAttempt.scenarioId,
                attempt: sourceAttempt.attempt,
                candidateCommit: 'candidate',
                agentAssetsHash: 'assets',
                requestedModel: model,
                observedModels: [model],
            },
        };

        const report = createReport([candidate], [scenario], [], [], [deployment]);
        assert.equal(report.liveDeployment.successes, 1);
        assert(!report.releaseAssessment.reasons.includes(
            'No live-deployment acceptance evidence is present.',
        ));
        assert.throws(
            () => createReport([candidate], [scenario], [], [], [{
                ...deployment,
                sourceProvenance: {
                    ...deployment.sourceProvenance,
                    candidateCommit: 'stale-candidate',
                },
            }]),
            /does not match a report input attempt/,
        );
    });

    test('binds VS Code parity evidence to the current scenario contract', () => {
        const debugParity = {
            target: 'backend' as const,
            sourceGlob: '**/src/index.ts',
            lineIncludes: 'const started = Date.now()',
            triggerUrl: 'http://127.0.0.1:7071/api/health',
            timeoutSeconds: 60,
        };
        const scenario = createScenario({
            acceptance: {
                local: {
                    startupTimeoutSeconds: 60,
                    probes: [],
                    debugParity,
                },
            },
        });
        const sourceAttempt = attempt('source-run', 1, 'autonomous_success', {
            candidateCommit: 'candidate',
            agentAssetsHash: 'assets',
        });
        const candidate = { ...createCandidateSummary([sourceAttempt]), through: 'local' };
        const parity = {
            outcome: 'passed' as const,
            sourceProvenance: {
                evaluationArm: 'rails' as const,
                through: 'local' as const,
                runId: sourceAttempt.runId,
                scenarioId: sourceAttempt.scenarioId,
                attempt: sourceAttempt.attempt,
                candidateCommit: 'candidate',
                agentAssetsHash: 'assets',
                requestedModel: model,
                observedModels: [model],
                debugParity,
            },
        };

        assert.equal(createReport([candidate], [scenario], [], [parity]).vscodeParity.successes, 1);
        assert.throws(
            () => createReport([candidate], [scenario], [], [{
                ...parity,
                sourceProvenance: {
                    ...parity.sourceProvenance,
                    debugParity: { ...debugParity, lineIncludes: 'stale breakpoint' },
                },
            }]),
            /does not match a report input attempt/,
        );
    });

    test('rejects scaffold and local endpoint pairing', () => {
        const scenario = createScenario();
        const candidate = createCandidateSummary([attempt('candidate', 1, 'autonomous_success')]);
        const baseline = {
            ...createBaselineSummary([attempt('baseline', 1, 'autonomous_success')]),
            through: 'local',
        };

        assert.throws(
            () => createReport([candidate], [scenario], [baseline]),
            /evaluation endpoint mismatch: candidate through endpoints \["scaffold"\], baseline through endpoints \["local"\]/,
        );
    });

    test('never matches attempts across endpoints even when endpoint sets are equal', () => {
        const scenario = createScenario();
        const candidateScaffold = createCandidateSummary([
            attempt('candidate-scaffold', 1, 'autonomous_success'),
        ]);
        const candidateLocal = {
            ...createCandidateSummary([attempt('candidate-local', 2, 'autonomous_success')]),
            through: 'local',
        };
        const baselineScaffold = createBaselineSummary([
            attempt('baseline-scaffold', 2, 'autonomous_success'),
        ]);
        const baselineLocal = {
            ...createBaselineSummary([attempt('baseline-local', 1, 'autonomous_success')]),
            through: 'local',
        };

        const comparison = createReport(
            [candidateScaffold, candidateLocal],
            [scenario],
            [baselineScaffold, baselineLocal],
        ).baselineComparison;
        assert(comparison);
        assert.equal(comparison.matchedAttempts, 0);
        assert.equal(comparison.unmatchedCandidateAttempts, 2);
        assert.equal(comparison.unmatchedBaselineAttempts, 2);
        assert.equal(comparison.modelProvenance.parity, 'not_evaluated');
    });

    test('rejects observed models that do not exactly match the requested pin', () => {
        const scenario = createScenario();
        const candidate = createCandidateSummary([
            attempt('candidate', 1, 'autonomous_success', { observedModels: [model, 'unexpected-model'] }),
        ]);
        const baseline = createBaselineSummary([attempt('baseline', 1, 'autonomous_success')]);

        assert.throws(
            () => createReport([candidate], [scenario], [baseline]),
            /Rails observed models \["test-model","unexpected-model"\]; expected exactly requested model "test-model"/,
        );
    });

    test('rejects conflicting summary and attempt model provenance', () => {
        const scenario = createScenario();
        const candidate = createCandidateSummary([
            attempt('candidate', 1, 'autonomous_success', {
                model: 'other-model',
                requestedModel: 'other-model',
                observedModels: ['other-model'],
            }),
        ]);
        const baseline = createBaselineSummary([
            attempt('baseline', 1, 'autonomous_success', {
                model: 'other-model',
                requestedModel: 'other-model',
                observedModels: ['other-model'],
            }),
        ]);

        assert.throws(
            () => createReport([candidate], [scenario], [baseline]),
            /conflicts with summary requested models/,
        );
    });

    test('rejects missing observed-model evidence for a declared arm', () => {
        const scenario = createScenario();
        const candidate = {
            ...createCandidateSummary([
                attempt('candidate', 1, 'autonomous_success', { observedModels: undefined }),
            ]),
            observedModels: undefined,
        };
        const baseline = createBaselineSummary([attempt('baseline', 1, 'autonomous_success')]);

        assert.throws(
            () => createReport([candidate], [scenario], [baseline]),
            /Candidate paired attempt api-ts-functions-minimal:1 is missing observed-model evidence under declared arm "rails"/,
        );
    });

    test('accepts identical endpoint and observed-model pairing with JSON and Markdown provenance', () => {
        const scenario = createScenario();
        const candidate = createCandidateSummary([attempt('candidate', 1, 'autonomous_success')]);
        const baseline = createBaselineSummary([attempt('baseline', 1, 'autonomous_success')]);

        const report = createReport([candidate], [scenario], [baseline]);
        const comparison = report.baselineComparison;
        assert(comparison);
        assert.deepEqual(comparison.endpointProvenance, {
            candidate: ['scaffold'],
            baseline: ['scaffold'],
        });
        assert.equal(comparison.modelProvenance.parity, 'verified');
        assert.deepEqual(comparison.modelProvenance.candidate.observedModels, [model]);
        assert.deepEqual(comparison.modelProvenance.baseline.observedModels, [model]);
        const markdown = renderMarkdown(report);
        assert.match(markdown, /Candidate evaluation endpoint\(s\): `scaffold`/);
        assert.match(markdown, /Baseline evaluation endpoint\(s\): `scaffold`/);
        assert.match(markdown, /Observed-model parity: \*\*verified\*\*/);
    });

    test('derives legacy treatment models from stage usage and exposes missing legacy parity evidence', () => {
        const scenario = createScenario();
        const candidate: EvaluationSummary = {
            ...createCandidateSummary([attempt('candidate', 1, 'autonomous_success')]),
            evaluationArm: undefined,
            observedModels: undefined,
            results: [{
                ...attempt('candidate', 1, 'autonomous_success'),
                evaluationArm: undefined,
                observedModels: undefined,
                stages: [{ name: 'scaffold', agentRun: { usage: { models: [model] } } }],
            }],
        };
        const baseline: EvaluationSummary = {
            ...createBaselineSummary([attempt('baseline', 1, 'autonomous_success')]),
            evaluationArm: undefined,
            observedModels: undefined,
            results: [{
                ...attempt('baseline', 1, 'autonomous_success'),
                evaluationArm: undefined,
                observedModels: undefined,
            }],
        };

        const report = createReport([candidate], [scenario], [baseline]);
        const comparison = report.baselineComparison;
        assert(comparison);
        assert.deepEqual(comparison.modelProvenance.candidate.observedModels, [model]);
        assert.equal(comparison.modelProvenance.candidate.status, 'verified');
        assert.equal(comparison.modelProvenance.baseline.status, 'legacy_missing');
        assert.equal(comparison.modelProvenance.parity, 'legacy_missing');
        assert.match(renderMarkdown(report), /Observed-model parity: \*\*legacy_missing\*\*/);
    });

    test('keeps legacy reports without a baseline compatible', () => {
        const scenario = createScenario();
        const legacyCandidate: EvaluationSummary = {
            ...createCandidateSummary([attempt('candidate', 1, 'autonomous_success')]),
            evaluationArm: undefined,
            requestedModels: undefined,
            observedModels: undefined,
            results: [{
                ...attempt('candidate', 1, 'autonomous_success'),
                evaluationArm: undefined,
                requestedModel: undefined,
                observedModels: undefined,
            }],
        };

        const report = createReport([legacyCandidate], [scenario], []);
        assert.equal(report.baselineComparison, undefined);
        assert.equal(report.autonomousOutcome.successes, 1);
    });
});

function createScenario(overrides: Partial<CorEvaluationScenario> = {}): BaselineScenario {
    return {
        schemaVersion: '1',
        id: 'api-ts-functions-minimal',
        prompt: 'Create an API.',
        baselinePrompt: 'Build a complete standalone TypeScript API with source code, configuration, automated tests, local VS Code debugging support, and deployment-ready infrastructure.',
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
            timeoutMinutes: 5,
            maxAgentRetries: 1,
        },
        ...overrides,
    };
}

function completedRun(observedModel: string): CorAgentRunResult {
    return {
        outcome: 'completed',
        startedAt: '2026-08-07T00:00:00.000Z',
        completedAt: '2026-08-07T00:00:01.000Z',
        durationMs: 1_000,
        usage: {
            apiCalls: 1,
            inputTokens: 10,
            outputTokens: 20,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            totalNanoAiu: 0,
            models: [observedModel],
        },
        toolCalls: [],
        errors: [],
    };
}

function failedTestValidation(): Awaited<
    ReturnType<Parameters<typeof runBaselineAttempt>[0]['projectValidator']['validate']>
> {
    return {
        outcome: 'failed',
        failureCode: 'sandboxCommandFailed',
        error: '.: "npm test" failed.',
        commands: [{
            ecosystem: 'node',
            relativeDirectory: '.',
            command: 'npm run build',
            success: true,
            durationMs: 1,
            stdout: '',
            stderr: '',
        }, {
            ecosystem: 'node',
            relativeDirectory: '.',
            command: 'npm test',
            success: false,
            failureKind: 'commandExit',
            durationMs: 1,
            stdout: '',
            stderr: 'No test files found',
        }],
    };
}

async function createAttemptInput(
    scratch: string,
    overrides: {
        executor?: Parameters<typeof runBaselineAttempt>[0]['executor'];
        projectValidator?: Parameters<typeof runBaselineAttempt>[0]['projectValidator'];
        localRuntimeValidator?: Parameters<typeof runBaselineAttempt>[0]['localRuntimeValidator'];
        through?: Parameters<typeof runBaselineAttempt>[0]['through'];
    } = {},
): Promise<Parameters<typeof runBaselineAttempt>[0]> {
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
        through: overrides.through ?? 'scaffold',
        executor: overrides.executor ?? { run: async () => completedRun(model) },
        projectValidator: overrides.projectValidator ?? {
            validate: async () => ({ outcome: 'passed', commands: [] }),
        },
        localRuntimeValidator: overrides.localRuntimeValidator ?? {
            validate: async () => {
                throw new Error('Local validation should not run in scaffold mode.');
            },
        },
    };
}

async function withProjectScratch(operation: (scratch: string) => Promise<void>): Promise<void> {
    await fs.mkdir(testResultsRoot, { recursive: true });
    const scratch = await fs.mkdtemp(path.join(testResultsRoot, 'baseline-contract-test-'));
    try {
        await operation(scratch);
    } finally {
        await fs.rm(scratch, { recursive: true, force: true });
    }
}

function attempt(
    runId: string,
    attemptNumber: number,
    outcome: EvaluationAttempt['outcome'],
    overrides: Partial<EvaluationAttempt> = {},
): EvaluationAttempt {
    return {
        runId,
        scenarioId: 'api-ts-functions-minimal',
        attempt: attemptNumber,
        outcome,
        durationMs: 100,
        agentRetries: 0,
        model,
        requestedModel: model,
        observedModels: [model],
        evaluationArm: 'rails',
        ...overrides,
    };
}

function createCandidateSummary(results: EvaluationAttempt[]): EvaluationSummary {
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

function createBaselineSummary(results: EvaluationAttempt[]): EvaluationSummary {
    return {
        candidateCommit: 'candidate',
        agentAssetsHash: 'not-applicable:baseline-controlled',
        through: 'scaffold',
        evaluationArm: 'baseline-controlled',
        requestedModel: model,
        observedModels: [model],
        results: results.map(result => ({ ...result, evaluationArm: 'baseline-controlled' })),
    };
}
