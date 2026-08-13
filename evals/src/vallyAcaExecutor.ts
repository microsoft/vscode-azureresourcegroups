/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/naming-convention -- Canonical COR_EVAL_* names are an external wire contract. */

import {
    createDefaultGraderRegistry,
    gradeTrajectory,
    type Backend,
    type BackendConfig,
    type BackendRegistry,
    type BackendRunContext,
    type DisposableTrialResult,
    type Executor,
    type ExecutorOptions,
    type ExecutorRegistry,
    type GraderRegistry,
    type GradeTrialOptions,
    type Stimulus,
    type StimulusGradeResult,
    type Trajectory,
    type TrialIdentity,
    type TrialOptions,
} from '@microsoft/vally';
import { exportArtifactsFromDir, exportWorkspaceTree } from '@microsoft/vally/workspace';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import {
    type AttemptEvidence,
    type LoadedSummary,
    type SummaryEvidence,
    createCustomMetrics,
    createTrajectory,
} from './vally';
import {
    type CorEvaluationScenario,
    loadScenarios,
} from './scenario';
import {
    canContinueAfterProjectValidationFailure,
    classifySandboxValidationCommand,
    readSandboxIds,
    type SandboxValidationCommandResult,
    type SandboxProjectValidationResult,
} from './SandboxProjectValidator';
import {
    AUTHORITATIVE_SCHEMA,
    CUSTOM_METRICS_SCHEMA,
    CorAuthoritativeGrader,
    GATE_GROUPS,
} from '../vally/plugins/cor-graders/authoritative';
import {
    createVallyRunDiagnostics,
    type VallyRunDiagnostics,
    writeVallyRunDiagnostics,
} from './vallyRunDiagnostics';

export const vallyAcaExecutorName = 'cor-aca';
export const vallyAcaExperimentBackendName = 'cor-aca';

export type VallyAcaArm = 'rails' | 'baseline-controlled';
export type VallyAcaEndpoint = 'plan' | 'scaffold' | 'local';

export interface VallyAcaTrialSelection {
    scenarioId: string;
    arm: VallyAcaArm;
    endpoint: VallyAcaEndpoint;
    model: string;
}

export interface NativeAttemptRequest extends VallyAcaTrialSelection {
    executionId: string;
    repoRoot: string;
    outputDirectory: string;
    attempts: 1;
    concurrency: 1;
    env: Record<string, string>;
    signal: AbortSignal;
}

export interface NativeAttemptRun {
    outputDirectory: string;
    summaryPath: string;
}

export interface NativeAttemptRunner {
    run(request: NativeAttemptRequest): Promise<NativeAttemptRun>;
    cleanup(request: NativeAttemptRequest): Promise<void>;
}

export interface AcaCommandRunner {
    run(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }>;
}

export interface VallyAcaExecutorDependencies {
    repoRoot?: string;
    runner?: NativeAttemptRunner;
    scenarioLoader?: () => Promise<CorEvaluationScenario[]>;
}

export interface CorAcaExperimentBackendDependencies {
    repoRoot?: string;
    stateRoot?: string;
    executorFactory?: () => Executor;
    graderRegistryFactory?: () => GraderRegistry;
}

interface NativeSummary extends SummaryEvidence {
    concurrency?: number;
    attempts?: number;
}

interface ActiveExecution {
    controller: AbortController;
    cleanupDone: Promise<void>;
    resolveCleanupDone: () => void;
}

export class VallyAcaExecutor implements Executor {
    public readonly name = vallyAcaExecutorName;
    public readonly supportsEnvVars = true;

    private readonly repoRoot: string;
    private readonly runner: NativeAttemptRunner;
    private readonly scenarioLoader: () => Promise<CorEvaluationScenario[]>;
    private readonly active = new Set<ActiveExecution>();

    public constructor(dependencies: VallyAcaExecutorDependencies = {}) {
        this.repoRoot = path.resolve(dependencies.repoRoot ?? path.join(__dirname, '..', '..'));
        this.runner = dependencies.runner ?? new SpawnedNativeAttemptRunner();
        this.scenarioLoader = dependencies.scenarioLoader
            ?? (() => loadScenarios(path.join(this.repoRoot, 'evals', 'scenarios')));
    }

    public async execute(stimulus: Stimulus, options: ExecutorOptions): Promise<Trajectory> {
        const artifactDirectory = requireExecutorArtifactDirectory(options);
        assertDisjointDirectories(artifactDirectory, options.workDir);
        const selection = resolveVallyAcaTrialSelection(stimulus, options);
        const scenarios = await this.scenarioLoader();
        const scenario = scenarios.find(candidate => candidate.id === selection.scenarioId);
        if (!scenario) {
            throw new Error(`Unknown Copilot on Rails scenario "${selection.scenarioId}".`);
        }
        if (selection.arm === 'baseline-controlled' && !scenario.baselinePrompt?.trim()) {
            throw new Error(`Scenario "${selection.scenarioId}" has no controlled-baseline prompt.`);
        }

        await fs.mkdir(artifactDirectory, { recursive: true });
        const nativeOutputDirectory = path.join(artifactDirectory, 'native');
        await fs.rm(nativeOutputDirectory, { recursive: true, force: true });
        await fs.mkdir(nativeOutputDirectory, { recursive: true });

        const controller = new AbortController();
        let resolveCleanupDone: (() => void) | undefined;
        const cleanupDone = new Promise<void>(resolve => {
            resolveCleanupDone = resolve;
        });
        const active: ActiveExecution = {
            controller,
            cleanupDone,
            resolveCleanupDone: resolveCleanupDone as () => void,
        };
        this.active.add(active);

        const executionId = options.sessionID?.trim() || randomUUID();
        const requestedOwnerLabel = options.env?.COR_EVAL_OWNER_ID;
        const ownerLabel = requestedOwnerLabel && isValidOwnerLabel(requestedOwnerLabel)
            ? requestedOwnerLabel
            : createTrialOwnerLabel(executionId);
        const request: NativeAttemptRequest = {
            ...selection,
            executionId,
            repoRoot: this.repoRoot,
            outputDirectory: nativeOutputDirectory,
            attempts: 1,
            concurrency: 1,
            env: {
                ...options.env,
                COR_EVAL_OWNER_ID: ownerLabel,
                COR_EVAL_TRIAL_LABEL: ownerLabel,
            },
            signal: controller.signal,
        };
        const timeout = setTimeout(() => {
            controller.abort(new VallyAcaTimeoutError(options.timeout));
        }, options.timeout);
        let completedManifest: Record<string, unknown> | undefined;

        try {
            const applicability = authoritativeApplicability(stimulus, scenario, selection);
            const run = await raceWithAbort(this.runner.run(request), controller.signal);
            if (path.resolve(run.outputDirectory) !== path.resolve(nativeOutputDirectory)) {
                throw new Error('Native runner wrote outside its assigned executor artifact directory.');
            }
            const summaryRelativePath = path.relative(run.outputDirectory, run.summaryPath);
            if (summaryRelativePath.startsWith('..') || path.isAbsolute(summaryRelativePath)) {
                throw new Error('Native summary path must be inside the native output directory.');
            }
            const summaryPath = path.join(nativeOutputDirectory, summaryRelativePath);
            const summary = await readNativeSummary(summaryPath);
            const attempt = validateNativeSummary(summary, selection);
            assertObservedModel(attempt, selection.model);

            const resultDirectory = path.join(nativeOutputDirectory, attempt.runId);
            const runResultPath = path.join(resultDirectory, 'run-result.json');
            const archivedWorkspace = path.join(resultDirectory, 'workspace');
            await Promise.all([
                assertFile(runResultPath, 'native run-result'),
                assertDirectory(archivedWorkspace, 'archived generated workspace'),
            ]);
            await mirrorWorkspace(archivedWorkspace, options.workDir);

            const durableSummaryPath = path.join(artifactDirectory, 'native-summary.json');
            const durableRunResultPath = path.join(artifactDirectory, 'run-result.json');
            await Promise.all([
                fs.copyFile(summaryPath, durableSummaryPath),
                fs.copyFile(runResultPath, durableRunResultPath),
                fs.copyFile(summaryPath, path.join(options.workDir, 'native-summary.json')),
                fs.copyFile(runResultPath, path.join(options.workDir, 'run-result.json')),
            ]);

            const source: LoadedSummary = {
                summary,
                summaryPath: durableSummaryPath,
            };
            const adapted = createTrajectory(
                source,
                attempt,
                scenario,
                selection.model,
                resultDirectory,
                artifactDirectory,
            );
            const trajectoryStimulus = createExecutedStimulus(stimulus, adapted.stimulus);
            const promptSource = (attempt.sourceProvenance ?? summary.sourceProvenance)?.promptSource
                ?? `evals/scenarios/${selection.scenarioId}.json#${selection.arm === 'rails' ? 'prompt' : 'baselinePrompt'}`;
            const trajectory: Trajectory = {
                ...adapted,
                stimulus: trajectoryStimulus,
                workDir: options.workDir,
                artifactDir: artifactDirectory,
                artifactDirStrict: true,
                metadata: {
                    ...adapted.metadata,
                    executor: vallyAcaExecutorName,
                    model: selection.model,
                    evaluationArm: selection.arm,
                    endpoint: selection.endpoint,
                    scenarioId: selection.scenarioId,
                    runId: attempt.runId,
                    requestedModel: selection.model,
                    observedModels: attempt.observedModels,
                    candidateCommit: attempt.candidateCommit ?? summary.candidateCommit,
                    agentAssetsHash: attempt.agentAssetsHash ?? summary.agentAssetsHash,
                    evaluationDefinition: attempt.evaluationDefinition,
                    evaluationDefinitionHash: attempt.evaluationDefinition?.combinedHash,
                    scenarioHash: attempt.evaluationDefinition?.scenarioCorpusHash,
                    promptSource,
                    evaluationDefinitions: summary.evaluationDefinitions,
                    sourceProvenance: {
                        ...(attempt.sourceProvenance ?? summary.sourceProvenance),
                        promptSource,
                    },
                } as Trajectory['metadata'],
            };
            const adapterMetrics = createCustomMetrics(summary, attempt, scenario);
            const authoritative = createAuthoritativeArtifacts(
                summary,
                attempt,
                scenario,
                selection,
                trajectory,
                applicability,
            );
            await Promise.all([
                writeVallyRunDiagnostics(artifactDirectory, authoritative.diagnostics),
                writeJson(path.join(artifactDirectory, 'adapter-metrics.json'), adapterMetrics),
                writeJson(path.join(options.workDir, 'adapter-metrics.json'), adapterMetrics),
                writeJson(path.join(artifactDirectory, 'cor-validation.json'), authoritative.validation),
                writeJson(path.join(artifactDirectory, 'custom_metrics.json'), authoritative.metrics),
                writeJson(path.join(options.workDir, 'cor-validation.json'), authoritative.validation),
                writeJson(path.join(options.workDir, 'custom_metrics.json'), authoritative.metrics),
            ]);
            const manifest = {
                schemaVersion: '1',
                executor: vallyAcaExecutorName,
                ownerLabel,
                stimulus,
                selection,
                native: {
                    outputDirectory: 'native',
                    summary: 'native-summary.json',
                    runResult: 'run-result.json',
                    archivedWorkspace: path.relative(artifactDirectory, archivedWorkspace),
                    runId: attempt.runId,
                    outcome: attempt.outcome,
                    requestedModel: attempt.requestedModel,
                    observedModels: attempt.observedModels,
                },
                provenance: {
                    candidateCommit: attempt.candidateCommit ?? summary.candidateCommit,
                    agentAssetsHash: attempt.agentAssetsHash ?? summary.agentAssetsHash,
                    evaluationDefinition: attempt.evaluationDefinition,
                    evaluationDefinitions: summary.evaluationDefinitions,
                    sourceProvenance: attempt.sourceProvenance ?? summary.sourceProvenance,
                },
                validation: {
                    attempts: 1,
                    concurrency: 1,
                    modelIdentityMatched: true,
                    authoritativeValidators: 'aca-sandboxes',
                    workspaceCopiedTo: options.workDir,
                    artifactDirStrict: true,
                    cleanupVerified: false,
                },
            };
            completedManifest = manifest;
            await Promise.all([
                writeJson(path.join(artifactDirectory, 'validation-manifest.json'), manifest),
                writeJson(path.join(options.workDir, 'validation-manifest.json'), manifest),
            ]);

            return {
                ...trajectory,
                metadata: {
                    ...trajectory.metadata,
                    candidateCommit: manifest.provenance.candidateCommit,
                    agentAssetsHash: manifest.provenance.agentAssetsHash,
                } as Trajectory['metadata'],
            };
        } catch (error) {
            const failureManifest = {
                schemaVersion: '1',
                executor: vallyAcaExecutorName,
                ownerLabel,
                stimulus,
                selection,
                status: error instanceof VallyAcaTimeoutError ? 'timed-out' : 'failed',
                error: {
                    name: error instanceof Error ? error.name : 'Error',
                    message: error instanceof Error ? error.message : String(error),
                    ...(
                        error
                        && typeof error === 'object'
                        && 'code' in error
                        && typeof error.code === 'string'
                            ? { code: error.code }
                            : {}
                    ),
                },
            };
            await fs.mkdir(options.workDir, { recursive: true }).catch(() => {
                // The manifest writes below retain the original execution error if the workspace is unavailable.
            });
            await Promise.all([
                writeJson(path.join(artifactDirectory, 'validation-manifest.json'), failureManifest),
                writeJson(path.join(options.workDir, 'validation-manifest.json'), failureManifest),
            ]).catch(() => {
                // Preserve the original execution error when even the durable failure manifest cannot be written.
            });
            throw error;
        } finally {
            clearTimeout(timeout);
            if (!controller.signal.aborted) {
                controller.abort(new VallyAcaAbortError('The Vally ACA trial has finished.'));
            }
            try {
                await this.runner.cleanup(request);
                if (completedManifest) {
                    const validation = completedManifest.validation as Record<string, unknown>;
                    validation.cleanupVerified = true;
                    await Promise.all([
                        writeJson(
                            path.join(artifactDirectory, 'validation-manifest.json'),
                            completedManifest,
                        ),
                        writeJson(
                            path.join(options.workDir, 'validation-manifest.json'),
                            completedManifest,
                        ),
                    ]);
                }
            } finally {
                this.active.delete(active);
                active.resolveCleanupDone();
            }
        }
    }

    public async shutdown(): Promise<void> {
        const active = [...this.active];
        for (const execution of active) {
            if (!execution.controller.signal.aborted) {
                execution.controller.abort(new VallyAcaAbortError('The Vally ACA executor is shutting down.'));
            }
        }
        await Promise.all(active.map(execution => execution.cleanupDone));
    }
}

export class SpawnedNativeAttemptRunner implements NativeAttemptRunner {
    private readonly active = new Map<string, SpawnedAttempt>();
    private readonly ownerLabels = new Map<string, string>();
    private readonly aca: AcaCommandRunner;
    private readonly spawnChild: typeof spawn;

    public constructor(
        aca: AcaCommandRunner = new SpawnedAcaCommandRunner(),
        spawnChild: typeof spawn = spawn,
    ) {
        this.aca = aca;
        this.spawnChild = spawnChild;
    }

    public async run(request: NativeAttemptRequest): Promise<NativeAttemptRun> {
        const ownerLabel = request.env.COR_EVAL_OWNER_ID;
        if (!ownerLabel || !isValidOwnerLabel(ownerLabel)) {
            throw new Error('Spawned native ACA attempts require an exact valid COR_EVAL_OWNER_ID.');
        }
        this.ownerLabels.set(request.executionId, ownerLabel);
        const script = request.arm === 'rails'
            ? path.join(request.repoRoot, 'evals', 'src', 'run.ts')
            : path.join(request.repoRoot, 'evals', 'src', 'baseline.ts');
        const stdoutPath = path.join(request.outputDirectory, 'native-stdout.log');
        const stderrPath = path.join(request.outputDirectory, 'native-stderr.log');
        const [stdout, stderr] = await Promise.all([
            fs.open(stdoutPath, 'w'),
            fs.open(stderrPath, 'w'),
        ]);
        const args = [
            '--import',
            'tsx',
            script,
            '--attempts',
            String(request.attempts),
            '--concurrency',
            String(request.concurrency),
            '--through',
            request.endpoint,
            '--model',
            request.model,
            '--scenario',
            request.scenarioId,
            '--output',
            request.outputDirectory,
        ];
        const child = this.spawnChild(process.execPath, args, {
            cwd: request.repoRoot,
            detached: process.platform !== 'win32',
            env: { ...process.env, ...request.env },
            stdio: ['ignore', stdout.fd, stderr.fd],
        });
        const attempt = createSpawnedAttempt(child);
        this.active.set(request.executionId, attempt);
        const onAbort = (): void => {
            terminateSpawnedAttempt(attempt);
        };
        request.signal.addEventListener('abort', onAbort, { once: true });
        try {
            const exit = await attempt.closed;
            if (request.signal.aborted) {
                throw abortReason(request.signal);
            }
            const summaryPath = path.join(request.outputDirectory, 'summary.json');
            try {
                await fs.access(summaryPath);
            } catch {
                throw new Error(
                    `Copilot on Rails ${request.arm} attempt exited with code ${String(exit.code)}`
                    + ` and did not write summary.json. See ${stderrPath}.`,
                );
            }
            return {
                outputDirectory: request.outputDirectory,
                summaryPath,
            };
        } finally {
            request.signal.removeEventListener('abort', onAbort);
            this.active.delete(request.executionId);
            await Promise.all([stdout.close(), stderr.close()]);
        }
    }

    public async cleanup(request: NativeAttemptRequest): Promise<void> {
        const attempt = this.active.get(request.executionId);
        if (attempt) {
            terminateSpawnedAttempt(attempt);
            await attempt.closed;
        }
        const ownerLabel = this.ownerLabels.get(request.executionId);
        this.ownerLabels.delete(request.executionId);
        if (ownerLabel) {
            await sweepOwnedSandboxes(this.aca, ownerLabel);
        }
    }
}

export class SpawnedAcaCommandRunner implements AcaCommandRunner {
    public async run(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
        const result = await promisify(execFile)('aca', args, {
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
        });
        return {
            stdout: result.stdout,
            stderr: result.stderr,
        };
    }
}

export class VallyAcaTimeoutError extends Error {
    public readonly code = 'COR_ACA_TIMEOUT';

    public constructor(timeoutMs: number) {
        super(`Copilot on Rails ACA trial exceeded the Vally hard timeout of ${timeoutMs}ms.`);
        this.name = 'VallyAcaTimeoutError';
    }
}

export class VallyAcaAbortError extends Error {
    public readonly code = 'COR_ACA_ABORTED';

    public constructor(message: string) {
        super(message);
        this.name = 'VallyAcaAbortError';
    }
}

export function resolveVallyAcaTrialSelection(
    stimulus: Stimulus,
    options: Pick<ExecutorOptions, 'env' | 'model'>,
    processEnvironment: NodeJS.ProcessEnv = process.env,
): VallyAcaTrialSelection {
    const scenarioId = resolveCanonicalSelectionValue(
        stimulus,
        options.env,
        processEnvironment,
        'COR_EVAL_SCENARIO_ID',
        'scenarioId',
        undefined,
        undefined,
        'scenario',
    );
    const arm = resolveCanonicalSelectionValue(
        stimulus,
        options.env,
        processEnvironment,
        'COR_EVAL_ARM',
        'arm',
        ['rails', 'baseline-controlled'] as const,
    );
    const endpoint = resolveCanonicalSelectionValue(
        stimulus,
        options.env,
        processEnvironment,
        'COR_EVAL_ENDPOINT',
        'endpoint',
        ['plan', 'scaffold', 'local'] as const,
    );
    if (arm === 'baseline-controlled' && endpoint === 'plan') {
        throw new Error('The controlled baseline does not support the "plan" endpoint.');
    }
    const model = resolveCanonicalSelectionValue(
        stimulus,
        options.env,
        processEnvironment,
        'COR_EVAL_MODEL',
        'model',
        undefined,
        options.model,
    );
    if (!model) {
        throw new Error('Vally must provide an explicit non-empty model for cor-aca.');
    }
    const requestedModel = options.model?.trim();
    if (requestedModel && requestedModel !== model) {
        throw new Error(
            `Canonical model "${model}" does not match Vally requested model "${requestedModel}".`,
        );
    }
    return { scenarioId, arm, endpoint, model };
}

export function registerExecutors(registry: ExecutorRegistry): void {
    registry.register(new VallyAcaExecutor());
}

export class CorAcaExperimentBackend implements Backend {
    public readonly name = vallyAcaExperimentBackendName;

    private readonly repoRoot: string;
    private readonly stateRoot: string;
    private readonly executorFactory: () => Executor;
    private readonly graderRegistryFactory: () => GraderRegistry;
    private readonly cleanups = new Set<() => Promise<void>>();
    private disposed = false;

    public constructor(dependencies: CorAcaExperimentBackendDependencies = {}) {
        this.repoRoot = path.resolve(dependencies.repoRoot ?? path.join(__dirname, '..', '..'));
        this.stateRoot = path.resolve(
            dependencies.stateRoot ?? path.join(this.repoRoot, 'evals', 'results', '.vally-cor-aca'),
        );
        this.executorFactory = dependencies.executorFactory
            ?? (() => new VallyAcaExecutor({ repoRoot: this.repoRoot }));
        this.graderRegistryFactory = dependencies.graderRegistryFactory
            ?? createCorAcaGraderRegistry;
    }

    public async prepare(config: BackendConfig, _context: BackendRunContext): Promise<void> {
        if (this.disposed) {
            throw new Error('cor-aca backend has been shut down');
        }
        const configuredStateRoot = config['state-root'];
        if (configuredStateRoot !== undefined) {
            const value = Array.isArray(configuredStateRoot)
                ? configuredStateRoot[configuredStateRoot.length - 1]
                : configuredStateRoot;
            if (path.resolve(value) !== this.stateRoot) {
                throw new Error(
                    `cor-aca state-root is fixed at construction time (${this.stateRoot});`
                    + ' configure it through the backend factory.',
                );
            }
        }
        await fs.mkdir(this.stateRoot, { recursive: true });
    }

    public async runTrial(
        item: TrialIdentity,
        options: TrialOptions,
    ): Promise<DisposableTrialResult> {
        if (this.disposed) {
            throw new Error('cor-aca backend has been shut down');
        }
        const requiredGates = requireBackendAuthoritativeContract(item.stimulus);
        const selectionEnv = createBackendSelectionEnv(item);
        const hostSessionLog = options.runOptions.sessionLog;
        if (hostSessionLog && !hostSessionLog.executorArtifactsDir?.trim()) {
            throw new Error(
                'cor-aca requires a host sessionLog.executorArtifactsDir when Vally provides sessionLog.',
            );
        }
        await options.context.onPhase?.('preparing');
        await fs.mkdir(this.stateRoot, { recursive: true });
        const trialRoot = await fs.mkdtemp(path.join(
            this.stateRoot,
            `${safePathSegment(item.evalName)}-${safePathSegment(item.variant)}-`,
        ));
        const workDir = path.join(trialRoot, 'workspace');
        const artifactDir = path.join(trialRoot, 'artifacts');
        const sessionDir = path.join(trialRoot, 'session');
        await Promise.all([
            fs.mkdir(workDir, { recursive: true }),
            ...(!hostSessionLog
                ? [
                    fs.mkdir(artifactDir, { recursive: true }),
                    fs.mkdir(sessionDir, { recursive: true }),
                ]
                : []),
        ]);
        const executor = this.executorFactory();
        const sessionLog = hostSessionLog ?? {
            rootDir: sessionDir,
            sessionID: selectionEnv.COR_EVAL_TRIAL_LABEL,
            executorArtifactsDir: artifactDir,
        };
        let cleanupPromise: Promise<void> | undefined;
        const cleanup = async (): Promise<void> => {
            if (cleanupPromise) {
                return await cleanupPromise;
            }
            cleanupPromise = (async () => {
                this.cleanups.delete(cleanup);
                let shutdownError: unknown;
                try {
                    await executor.shutdown();
                } catch (error) {
                    shutdownError = error;
                }
                let scrubError: unknown;
                try {
                    await fs.rm(trialRoot, { recursive: true, force: true });
                } catch (error) {
                    scrubError = error;
                }
                if (shutdownError && scrubError) {
                    throw new AggregateError(
                        [shutdownError, scrubError],
                        'cor-aca executor cleanup and host trial-directory scrubbing both failed.',
                    );
                }
                if (shutdownError) {
                    throw shutdownError;
                }
                if (scrubError) {
                    throw scrubError;
                }
            })();
            return await cleanupPromise;
        };
        this.cleanups.add(cleanup);
        const exportWorkspace = async (
            selection: Parameters<NonNullable<DisposableTrialResult['exportWorkspace']>>[0],
            targetDir: string,
        ) => selection.kind === 'workspace'
            ? exportWorkspaceTree(workDir, targetDir)
            : exportArtifactsFromDir({
                workspaceDir: workDir,
                targetDir,
                include: selection.include,
                exclude: selection.exclude,
            });

        await options.context.onPhase?.('running-prompt');
        let trajectory: Trajectory;
        try {
            trajectory = await executor.execute(item.stimulus, {
                timeout: options.runOptions.timeout ?? 120_000,
                maxAgentDurationMs: options.runOptions.maxAgentDurationMs,
                sessionID: hostSessionLog
                    ? hostSessionLog.sessionID
                    : selectionEnv.COR_EVAL_TRIAL_LABEL,
                workDir,
                model: item.model,
                reasoningEffort: options.runOptions.reasoningEffort,
                env: selectionEnv,
                sessionLog,
                traceContext: options.runOptions.traceContext,
            });
        } catch (error) {
            return {
                result: {
                    status: 'error',
                    error: trialError(error),
                    workDir,
                },
                exportWorkspace,
                cleanup,
            };
        }

        let gradeResult: StimulusGradeResult | undefined;
        let gradeCleanup: (() => Promise<void>) | undefined;
        const graderConfigs = [
            ...options.graderConfigs.filter(config => config.type !== 'cor-authoritative'),
            {
                type: 'cor-authoritative',
                name: 'backend-authoritative-release-hard-gates',
                config: { requiredGates },
            },
        ];
        if (!options.skipGrade) {
            try {
                const graded = await this.gradeTrial({
                    trajectory,
                    graderConfigs,
                    gradeOptions: {
                        ...options.gradeOptions,
                        weights: {
                            ['cor-authoritative']: 1,
                            ['custom-metrics']: 0,
                        },
                    },
                    context: options.context,
                });
                gradeCleanup = graded.cleanup;
                gradeResult = graded.result.status === 'success'
                    ? graded.result.gradeResult
                    : createSyntheticGraderError(
                        trajectory,
                        options.gradeOptions.stimulus?.name ?? item.stimulus.name,
                        graded.result.error.message,
                    );
            } catch (error) {
                gradeResult = createSyntheticGraderError(
                    trajectory,
                    options.gradeOptions.stimulus?.name ?? item.stimulus.name,
                    errorMessage(error),
                );
            }
        }

        const executionCleanup = cleanup;
        let combinedCleanupPromise: Promise<void> | undefined;
        const combinedCleanup = async (): Promise<void> => {
            if (combinedCleanupPromise) {
                return await combinedCleanupPromise;
            }
            combinedCleanupPromise = (async () => {
                this.cleanups.delete(combinedCleanup);
                await gradeCleanup?.().catch(() => {
                    // Grading allocates no ACA resources and cleanup is best-effort.
                });
                await executionCleanup();
            })();
            return await combinedCleanupPromise;
        };
        this.cleanups.delete(executionCleanup);
        this.cleanups.add(combinedCleanup);
        return {
            result: {
                status: 'success',
                trajectory,
                workDir,
                ...(gradeResult ? { gradeResult } : {}),
            },
            exportWorkspace,
            cleanup: combinedCleanup,
        };
    }

    public async gradeTrial(options: GradeTrialOptions): Promise<DisposableTrialResult> {
        if (this.disposed) {
            throw new Error('cor-aca backend has been shut down');
        }
        const { trajectory, graderConfigs, gradeOptions, context } = options;
        const stimulusName = gradeOptions.stimulus?.name ?? trajectory.stimulus.name;
        try {
            const registry = mergeGraderRegistries(
                this.graderRegistryFactory(),
                gradeOptions.registry,
            );
            const result = await gradeTrajectory(trajectory, graderConfigs, {
                ...gradeOptions,
                registry,
            });
            return {
                result: {
                    status: 'success',
                    trajectory,
                    gradeResult: {
                        ...result,
                        stimulusName,
                        trajectoryId: trajectory.id,
                        timestamp: new Date(),
                    },
                },
                cleanup: noopCleanup,
            };
        } catch (error) {
            const message = errorMessage(error);
            try {
                await context.onDiagnostic?.({
                    severity: 'error',
                    code: 'grade-failed',
                    message: `Grading failed for stimulus "${stimulusName}": ${message}`,
                    path: trajectory.workDir,
                });
            } catch {
                // Diagnostics are best-effort and must never strand a disposable result.
            }
            return {
                result: {
                    status: 'error',
                    error: trialError(error),
                    trajectory,
                },
                cleanup: noopCleanup,
            };
        }
    }

    public async shutdown(): Promise<void> {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        const results = await Promise.allSettled([...this.cleanups].map(cleanup => cleanup()));
        this.cleanups.clear();
        const failures = results
            .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
            .map(result => result.reason);
        if (failures.length) {
            throw new AggregateError(failures, 'One or more cor-aca backend cleanups failed.');
        }
    }
}

export function registerBackends(registry: BackendRegistry): void {
    registry.register({
        name: vallyAcaExperimentBackendName,
        create: () => new CorAcaExperimentBackend(),
    });
}

function createCorAcaGraderRegistry(): GraderRegistry {
    const registry = createDefaultGraderRegistry();
    registry.register(new CorAuthoritativeGrader());
    return registry;
}

function mergeGraderRegistries(
    target: GraderRegistry,
    additional: GraderRegistry | undefined,
): GraderRegistry {
    for (const grader of additional?.getAll() ?? []) {
        if (!target.get(grader.metadata.name)) {
            target.register(grader);
        }
    }
    return target;
}

function createBackendSelectionEnv(item: TrialIdentity): Record<string, string> {
    const stimulusEnv = item.stimulus.environment?.env ?? {};
    const taggedScenario = preferredTag(item.stimulus, 'scenarioId', 'scenario');
    const taggedArm = optionalTag(item.stimulus, 'arm');
    const taggedEndpoint = optionalTag(item.stimulus, 'endpoint');
    const taggedModel = optionalTag(item.stimulus, 'model');
    const variantArm = item.variant === 'rails' || item.variant === 'baseline-controlled'
        ? item.variant
        : item.variant === 'baseline'
            ? 'baseline-controlled'
            : undefined;
    const selectedArm = taggedArm ?? variantArm;
    const selectedModel = taggedModel ?? item.model;
    const trialLabel = createTrialOwnerLabel(`${item.id}-${randomUUID()}`);
    return {
        ...stimulusEnv,
        ...(taggedScenario && !stimulusEnv.COR_EVAL_SCENARIO_ID
            ? { COR_EVAL_SCENARIO_ID: taggedScenario }
            : {}),
        ...(selectedArm && !stimulusEnv.COR_EVAL_ARM
            ? { COR_EVAL_ARM: selectedArm }
            : {}),
        ...(taggedEndpoint && !stimulusEnv.COR_EVAL_ENDPOINT
            ? { COR_EVAL_ENDPOINT: taggedEndpoint }
            : {}),
        ...(selectedModel && !stimulusEnv.COR_EVAL_MODEL
            ? { COR_EVAL_MODEL: selectedModel }
            : {}),
        COR_EVAL_OWNER_ID: trialLabel,
        COR_EVAL_TRIAL_LABEL: trialLabel,
    };
}

function requireBackendAuthoritativeContract(stimulus: Stimulus): string[] {
    if (optionalTag(stimulus, 'backendAuthoritative') !== 'true') {
        throw new Error(
            'cor-aca experiment stimuli must declare tag "backendAuthoritative" as "true".',
        );
    }
    return Object.entries(declaredApplicability(stimulus))
        .filter(([, required]) => required)
        .map(([gate]) => gate);
}

function createSyntheticGraderError(
    trajectory: Trajectory,
    stimulusName: string,
    message: string,
): StimulusGradeResult {
    return {
        name: 'grader-error',
        kind: 'code',
        passed: false,
        score: 0,
        evidence: `Grader execution error: ${message}`,
        stimulusName,
        trajectoryId: trajectory.id,
        timestamp: new Date(),
    };
}

function trialError(error: unknown): { message: string; stack?: string; retryable: boolean } {
    return {
        message: errorMessage(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        retryable: false,
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function noopCleanup(): Promise<void> {
    return Promise.resolve();
}

function safePathSegment(value: string): string {
    const safe = value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
    return (safe || 'trial').slice(0, 32);
}

function createTrialOwnerLabel(identity: string): string {
    const safe = identity.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-|-$/gu, '');
    const prefix = (safe || 'trial').slice(0, 16).replace(/-$/u, '');
    return `cor-${prefix}-${randomUUID()}`;
}

function isValidOwnerLabel(value: string): boolean {
    return /^[a-z0-9][a-z0-9-]{0,62}$/u.test(value);
}

export async function sweepOwnedSandboxes(aca: AcaCommandRunner, ownerLabel: string): Promise<void> {
    if (!isValidOwnerLabel(ownerLabel)) {
        throw new Error(`Invalid exact ACA sandbox owner label "${ownerLabel}".`);
    }
    let listed: { stdout: string };
    try {
        listed = await aca.run([
            'sandbox', 'list',
            '-l', `owner-id=${ownerLabel}`,
            '-o', 'json',
        ], 60_000);
    } catch (error) {
        throw new Error(
            `Failed to list ACA sandboxes for exact owner label "${ownerLabel}".`,
            { cause: error },
        );
    }
    let sandboxIds: string[];
    try {
        sandboxIds = [...new Set(readSandboxIds(listed.stdout))];
    } catch (error) {
        throw new Error(
            `Failed to parse ACA sandbox list for exact owner label "${ownerLabel}".`,
            { cause: error },
        );
    }
    const results = await Promise.allSettled(sandboxIds.map(id =>
        aca.run(['sandbox', 'delete', '--id', id, '--yes'], 5 * 60_000)));
    const failures = results.flatMap((result, index) =>
        result.status === 'rejected'
            ? [new Error(`Failed to delete owned ACA sandbox "${sandboxIds[index]}".`, { cause: result.reason })]
            : []);
    if (failures.length) {
        throw new AggregateError(
            failures,
            `Failed to delete ${failures.length} ACA sandbox(es) for exact owner label "${ownerLabel}".`,
        );
    }
}

function createExecutedStimulus(input: Stimulus, adapted: Stimulus): Stimulus {
    const tags: Record<string, string | string[]> = {
        ...input.tags,
        ...adapted.tags,
    };
    const scenarioId = input.tags?.scenarioId ?? adapted.tags?.scenario;
    if (scenarioId !== undefined) {
        tags.scenarioId = scenarioId;
    }
    return {
        ...input,
        prompt: adapted.prompt,
        tags,
        environment: {
            ...input.environment,
            env: {
                ...input.environment?.env,
                COR_EVAL_SCENARIO_ID: String(tags.scenarioId),
                COR_EVAL_MODEL: String(tags.model),
                COR_EVAL_ARM: String(tags.arm),
                COR_EVAL_ENDPOINT: String(tags.endpoint),
            },
        },
    };
}

interface AuthoritativeGate {
    status: 'passed' | 'failed' | 'not-applicable';
    evidence?: string[];
    reason?: string;
}

interface AuthoritativeArtifacts {
    validation: Record<string, unknown>;
    metrics: Record<string, unknown>;
    diagnostics: VallyRunDiagnostics;
}

function createAuthoritativeArtifacts(
    summary: NativeSummary,
    attempt: AttemptEvidence,
    scenario: CorEvaluationScenario,
    selection: VallyAcaTrialSelection,
    trajectory: Trajectory,
    applicability: Record<string, boolean>,
): AuthoritativeArtifacts {
    const identity = {
        scenarioId: selection.scenarioId,
        model: selection.model,
        arm: selection.arm,
        endpoint: selection.endpoint,
        runId: attempt.runId,
    };
    const definition = attempt.evaluationDefinition;
    const sourceProvenance = attempt.sourceProvenance ?? summary.sourceProvenance;
    const provenance = {
        scenarioId: selection.scenarioId,
        candidateCommit: attempt.candidateCommit ?? summary.candidateCommit ?? '',
        agentAssetsHash: attempt.agentAssetsHash ?? summary.agentAssetsHash ?? '',
        evaluationDefinitionHash: definition?.combinedHash ?? '',
        scenarioHash: definition?.scenarioCorpusHash ?? '',
        promptSource: sourceProvenance?.promptSource
            ?? `evals/scenarios/${selection.scenarioId}.json#${selection.arm === 'rails' ? 'prompt' : 'baselinePrompt'}`,
        model: selection.model,
        arm: selection.arm,
        endpoint: selection.endpoint,
        runId: attempt.runId,
    };
    const gates: Record<string, AuthoritativeGate> = Object.fromEntries(Object.keys(applicability).map(name => [
        name,
        authoritativeGate(name, applicability[name], summary, attempt, scenario, trajectory, provenance),
    ]));
    const diagnostics = createVallyRunDiagnostics(
        attempt,
        gates,
        scenario.validation.maxAgentRetries ?? 2,
    );
    for (const diagnostic of diagnostics.gates) {
        const gate = gates[diagnostic.gate];
        if (gate.status === 'failed') {
            gate.reason = diagnostic.explanation;
            gate.evidence = [
                diagnostic.explanation,
                'reports/run-diagnostics.md',
                ...(gate.evidence ?? []),
            ];
        }
    }
    const values: Record<string, boolean | null | number | string> = {};
    for (const [name, applicable] of Object.entries(applicability)) {
        const prefix = name.replaceAll('-', '_');
        const gate = gates[name];
        values[`${prefix}_applicable`] = applicable;
        values[`${prefix}_status`] = gate.status;
        values[`${prefix}_success`] = applicable ? gate.status === 'passed' : null;
    }
    values.authoritative_hard_gates_passed = Object.entries(applicability)
        .every(([name, applicable]) => !applicable || gates[name].status === 'passed');
    Object.assign(values, progressMetrics(applicability, gates));
    const shared = {
        identity,
        provenance,
        applicability,
        gates,
        diagnosticSummary: diagnostics.summary,
    };
    return {
        validation: {
            schema: AUTHORITATIVE_SCHEMA,
            schemaVersion: 1,
            ...shared,
        },
        metrics: {
            schema: CUSTOM_METRICS_SCHEMA,
            schemaVersion: 1,
            ...shared,
            values,
        },
        diagnostics,
    };
}

function authoritativeApplicability(
    stimulus: Stimulus,
    scenario: CorEvaluationScenario,
    selection: VallyAcaTrialSelection,
): Record<string, boolean> {
    const applicability = declaredApplicability(stimulus);
    validateApplicabilityContract(applicability, scenario, selection);
    return applicability;
}

/**
 * Gates that run in pipeline order. A run stops at the first one that fails, so the deepest gate
 * reached is a meaningful progress signal. The meta gates (cleanup, model, provenance) are excluded
 * because they are not sequential and would distort depth.
 */
const PIPELINE_GATE_ORDER: readonly string[] = [
    ...GATE_GROUPS.product,
    ...GATE_GROUPS.runtime,
    'deployment',
];

/**
 * Derived reporting metrics. These add a gradient to an otherwise binary result so that runs which
 * fail at the browser gate are distinguishable from runs which fail at build. They never influence
 * `authoritative_hard_gates_passed`, which stays the sole release decision.
 */
export function progressMetrics(
    applicability: Record<string, boolean>,
    gates: Record<string, AuthoritativeGate>,
): Record<string, number | string> {
    const metrics: Record<string, number | string> = {};
    const passed = (name: string): boolean => gates[name]?.status === 'passed';
    const applicableGates = Object.entries(applicability)
        .filter(([, applicable]) => applicable)
        .map(([name]) => name);

    metrics.gates_applicable = applicableGates.length;
    metrics.gates_passed = applicableGates.filter(passed).length;
    metrics.gates_pass_ratio = applicableGates.length
        ? round(metrics.gates_passed / applicableGates.length)
        : 0;

    for (const [group, members] of Object.entries(GATE_GROUPS)) {
        const applicableMembers = members.filter(name => applicability[name]);
        metrics[`${group}_gates_applicable`] = applicableMembers.length;
        metrics[`${group}_gates_passed`] = applicableMembers.filter(passed).length;
    }

    const pipeline = PIPELINE_GATE_ORDER.filter(name => applicability[name]);
    let depth = 0;
    while (depth < pipeline.length && passed(pipeline[depth])) {
        depth++;
    }
    metrics.pipeline_gates_applicable = pipeline.length;
    metrics.furthest_gate_depth = depth;
    metrics.furthest_gate_reached = depth >= pipeline.length
        ? 'complete'
        : pipeline[depth];
    metrics.deepest_gate_passed = depth === 0 ? 'none' : pipeline[depth - 1];
    metrics.pipeline_depth_ratio = pipeline.length ? round(depth / pipeline.length) : 0;

    // An advisory journey is excluded from the release decision, so its outcome would otherwise go
    // unmeasured. Charting it is what lets the journey earn promotion back to a hard gate.
    const journey = gates['browser-journey'];
    if (journey && journey.status !== 'not-applicable') {
        metrics.browser_journey_status = journey.status;
        metrics.browser_journey_enforced = applicability['browser-journey'] ? 1 : 0;
    }
    return metrics;
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

type GateVerdict = { passed: boolean; present: boolean };

/**
 * The load contract: the app served the page, rendered content and exposed controls. It is
 * app-controlled, so a failure here is always a real defect. Evidence written before the gate was
 * split carries no `loadPassed` flag, so a successful probe is read as a successful load.
 */
export function browserLoadVerdict(
    checks: ReadonlyArray<{ loadPassed?: boolean; success?: boolean }>,
): GateVerdict {
    return {
        passed: checks.length > 0 && checks.every(check => check.loadPassed ?? check.success === true),
        present: checks.length > 0,
    };
}

/**
 * The journey contract drives labels and DOM the prompt never specified. A probe that recorded no
 * journey status is reported absent rather than synthesised into a pass or a fail.
 */
export function browserJourneyVerdict(
    checks: ReadonlyArray<{ journeyStatus?: string }>,
): GateVerdict {
    const attempted = checks.filter(check => check.journeyStatus !== undefined);
    return {
        passed: attempted.length > 0 && attempted.every(check => check.journeyStatus === 'passed'),
        present: attempted.length > 0,
    };
}

/** A skipped check means the journey created nothing to verify, which is not a persistence defect. */
export function persistenceVerdict(
    checks: ReadonlyArray<{ success?: boolean; skipped?: boolean }>,
): GateVerdict {
    const attempted = checks.filter(check => check.skipped !== true);
    return {
        passed: attempted.length > 0 && attempted.every(check => check.success === true),
        present: attempted.length > 0,
    };
}

function declaredApplicability(stimulus: Stimulus): Record<string, boolean> {
    const allGates = Object.values(GATE_GROUPS).flat() as string[];
    return Object.fromEntries(allGates.map(gate => {
        const tagName = `applicability-${gate}`;
        const declaration = optionalTag(stimulus, tagName);
        if (declaration !== 'required' && declaration !== 'not-applicable') {
            throw new Error(
                `Stimulus tag "${tagName}" must explicitly be "required" or "not-applicable".`,
            );
        }
        return [gate, declaration === 'required'];
    }));
}

function validateApplicabilityContract(
    applicability: Record<string, boolean>,
    scenario: CorEvaluationScenario,
    selection: VallyAcaTrialSelection,
): void {
    const local = selection.endpoint === 'local';
    const scaffold = selection.endpoint === 'scaffold' || local;
    const possible: Record<string, boolean> = {
        planning: selection.arm === 'rails',
        scaffold,
        build: scaffold && scenario.validation.build,
        test: scaffold && scenario.validation.test,
        integration: local,
        ['local-runtime']: local,
        browser: local,
        ['browser-journey']: local,
        accessibility: local,
        persistence: local,
        worker: local,
        debugger: local,
        deployment: false,
        security: true,
        cleanup: scaffold,
        model: true,
        provenance: true,
    };
    for (const [gate, required] of Object.entries(applicability)) {
        if (required && !possible[gate]) {
            throw new Error(
                `Stimulus applicability contract cannot require "${gate}" for`
                + ` ${selection.arm}/${selection.endpoint}.`,
            );
        }
    }
    for (const gate of ['model', 'provenance']) {
        if (!applicability[gate]) {
            throw new Error(`Stimulus applicability contract must require "${gate}".`);
        }
    }
}

function authoritativeGate(
    name: string,
    applicable: boolean,
    summary: NativeSummary,
    attempt: AttemptEvidence,
    scenario: CorEvaluationScenario,
    trajectory: Trajectory,
    provenance: Record<string, string>,
): AuthoritativeGate {
    if (!applicable) {
        return {
            status: 'not-applicable',
            reason: name === 'deployment'
                ? 'The cor-aca executor rejects deployment; local ACA validation does not prove deployment.'
                : 'This gate is not applicable to the selected endpoint, arm, or scenario contract.',
        };
    }
    const result = gatePassed(name, summary, attempt, scenario, trajectory, provenance);
    return {
        status: result.passed ? 'passed' : 'failed',
        evidence: result.present
            ? result.evidence
            : [`missing applicable ${name} evidence in native-summary.json and run-result.json`],
    };
}

function gatePassed(
    name: string,
    _summary: NativeSummary,
    attempt: AttemptEvidence,
    scenario: CorEvaluationScenario,
    trajectory: Trajectory,
    provenance: Record<string, string>,
): { passed: boolean; present: boolean; evidence: string[] } {
    const stagesNamed = (stageName: string) => attempt.stages.filter(candidate => candidate.name === stageName);
    const stagePresent = (stageName: string) => stagesNamed(stageName).length > 0;
    const agentPassed = (stageName: string) =>
        stagesNamed(stageName).some(candidate => candidate.agentRun?.outcome === 'completed');
    const validationPassed = (stageName: string) =>
        [...stagesNamed(stageName)].reverse()
            .find(candidate => candidate.validation !== undefined)
            ?.validation?.valid === true;
    const handoffPassed = (stageName: string) =>
        stagesNamed(stageName).some(candidate => candidate.gateCalled === true);
    const projectValidation = [...attempt.stages].reverse()
        .map(candidate => candidate.buildValidation as ProjectValidationEvidence | undefined)
        .find((validation): validation is ProjectValidationEvidence => validation !== undefined);
    const validationCommands = projectValidation?.commands ?? [];
    const validationComplete = projectValidation?.outcome === 'passed'
        || (
            projectValidation?.outcome === 'failed'
            && canContinueAfterProjectValidationFailure({
                outcome: projectValidation.outcome,
                failureCode: projectValidation.failureCode as SandboxProjectValidationResult['failureCode'],
                error: projectValidation.error,
                commands: validationCommands,
            })
        );
    const buildCommands = validationCommands
        .filter(command => classifySandboxValidationCommand(command) === 'build');
    const testCommands = validationCommands
        .filter(command => classifySandboxValidationCommand(command) === 'test');
    const buildPassed = validationComplete
        && buildCommands.length > 0
        && buildCommands.every(command => command.success);
    const localEvidence = attempt.stages
        .map(candidate => candidate.localRuntimeValidation)
        .filter((value): value is NonNullable<typeof value> => value !== undefined);
    const localPassed = localEvidence.some(value => value.outcome === 'passed');
    const evidence = ['native-summary.json', 'run-result.json'];
    switch (name) {
        case 'planning': {
            const present = stagePresent('plan');
            return {
                passed: agentPassed('plan') && validationPassed('plan') && handoffPassed('plan'),
                present,
                evidence,
            };
        }
        case 'scaffold': {
            const present = stagePresent('scaffold');
            const passed = attempt.evaluationArm === 'rails'
                ? agentPassed('scaffold') && validationPassed('scaffold') && handoffPassed('scaffold')
                : agentPassed('scaffold');
            return { passed, present, evidence };
        }
        case 'build':
            return {
                passed: buildPassed,
                present: buildCommands.length > 0,
                evidence,
            };
        case 'test':
            return {
                passed: validationComplete
                    && testCommands.length > 0
                    && testCommands.every(command => command.success),
                present: testCommands.length > 0,
                evidence,
            };
        case 'integration': {
            const baselineValidation = validationPassed('integration');
            const railsValidation = agentPassed('integration')
                && validationPassed('integration')
                && handoffPassed('integration');
            const present = stagePresent('integration');
            return {
                passed: (
                    attempt.evaluationArm === 'rails'
                        ? railsValidation
                        : baselineValidation
                ) && buildPassed,
                present,
                evidence,
            };
        }
        case 'local-runtime':
            return { passed: localPassed, present: localEvidence.length > 0, evidence };
        case 'browser': {
            const checks = localEvidence.flatMap(value => value.browserChecks ?? []);
            return { ...browserLoadVerdict(checks), evidence };
        }
        case 'browser-journey': {
            const checks = localEvidence.flatMap(value => value.browserChecks ?? []);
            return { ...browserJourneyVerdict(checks), evidence };
        }
        case 'accessibility': {
            const checks = localEvidence.flatMap(value => value.browserChecks ?? []);
            const expected = (scenario.acceptance?.local?.probes ?? []).filter(probe => probe.browser);
            return {
                passed: checks.length >= expected.length
                    && checks.every((check, index) => {
                        if (check.accessibilityScanned !== true || check.accessibilityScanError) {
                            return false;
                        }
                        const configured = expected[index]?.browser?.maxSeriousAccessibilityViolations;
                        return configured === null
                            || (check.seriousAccessibilityViolations?.length ?? 0) <= (configured ?? 0);
                    }),
                present: checks.some(check =>
                    check.accessibilityScanned !== undefined
                    || check.accessibilityScanError !== undefined),
                evidence,
            };
        }
        case 'persistence': {
            const checks = localEvidence.flatMap(value => value.persistenceChecks ?? []);
            return { ...persistenceVerdict(checks), evidence };
        }
        case 'worker': {
            const checks = localEvidence.flatMap(value => value.workerEvents ?? []);
            return {
                passed: checks.length > 0 && checks.every(check => check.success === true),
                present: checks.length > 0,
                evidence,
            };
        }
        case 'debugger': {
            const checks = localEvidence.flatMap(value =>
                (value.commands ?? []).filter(command => command.kind === 'debugger'));
            return {
                passed: checks.length > 0 && checks.every(check => check.success === true),
                present: checks.length > 0,
                evidence,
            };
        }
        case 'cleanup':
            return {
                passed: !isCleanupFailureCode(attempt.failureCode),
                present: true,
                evidence,
            };
        case 'model': {
            const present = Boolean(attempt.requestedModel && attempt.observedModels?.length);
            return {
                passed: present
                    && attempt.requestedModel === trajectory.metadata.model
                    && attempt.observedModels?.every(model => model === trajectory.metadata.model) === true,
                present,
                evidence,
            };
        }

        case 'provenance': {
            const present = Object.values(provenance).every(value => value.length > 0);
            return { passed: present, present, evidence };
        }
        default:
            return { passed: false, present: false, evidence };
    }
}

function isCleanupFailureCode(value: string | undefined): boolean {
    return value !== undefined && [
        'agentCleanupFailed',
        'localSandboxCleanupFailed',
        'parityCleanupFailed',
        'resultFinalizationFailed',
        'sandboxCleanupFailed',
    ].includes(value);
}

interface ProjectValidationEvidence {
    outcome?: string;
    failureCode?: string;
    error?: string;
    commands?: SandboxValidationCommandResult[];
}

interface SpawnedAttempt {
    child: ChildProcess;
    closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
    killTimer?: NodeJS.Timeout;
    terminating: boolean;
}

function createSpawnedAttempt(child: ChildProcess): SpawnedAttempt {
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
    });
    return { child, closed, terminating: false };
}

function terminateSpawnedAttempt(attempt: SpawnedAttempt): void {
    if (attempt.terminating || attempt.child.exitCode !== null || attempt.child.signalCode !== null) {
        return;
    }
    attempt.terminating = true;
    signalSpawnedAttempt(attempt.child, 'SIGTERM');
    attempt.killTimer = setTimeout(() => {
        signalSpawnedAttempt(attempt.child, 'SIGKILL');
    }, 2_000);
    attempt.killTimer.unref();
    void attempt.closed.finally(() => {
        if (attempt.killTimer) {
            clearTimeout(attempt.killTimer);
        }
    });
}

function signalSpawnedAttempt(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.pid === undefined) {
        return;
    }
    try {
        if (process.platform === 'win32') {
            child.kill(signal);
        } else {
            process.kill(-child.pid, signal);
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw error;
        }
    }
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        throw abortReason(signal);
    }
    let rejectAbort: ((reason: unknown) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
    });
    const onAbort = (): void => rejectAbort?.(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    try {
        return await Promise.race([operation, aborted]);
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}

function abortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error
        ? signal.reason
        : new VallyAcaAbortError('The Vally ACA trial was aborted.');
}

function requireExecutorArtifactDirectory(options: ExecutorOptions): string {
    const artifactDirectory = options.sessionLog?.executorArtifactsDir?.trim();
    if (!artifactDirectory) {
        throw new Error(
            'cor-aca requires options.sessionLog.executorArtifactsDir; release trials cannot use'
            + ' temporary or workspace-fallback artifacts.',
        );
    }
    return path.resolve(artifactDirectory);
}

function assertDisjointDirectories(left: string, right: string): void {
    const first = path.resolve(left);
    const second = path.resolve(right);
    if (first === second || isPathWithin(first, second) || isPathWithin(second, first)) {
        throw new Error('cor-aca executorArtifactsDir and workDir must be disjoint directories.');
    }
}

function isPathWithin(candidate: string, parent: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveCanonicalSelectionValue<const T extends readonly string[]>(
    stimulus: Stimulus,
    env: Record<string, string> | undefined,
    processEnvironment: NodeJS.ProcessEnv,
    envName: string,
    tagName: string,
    allowed?: T,
    fallback?: string,
    legacyTagName?: string,
): T extends readonly string[] ? T[number] : string {
    const stimulusEnvValue = stimulus.environment?.env?.[envName]?.trim() || undefined;
    const optionEnvValue = env?.[envName]?.trim() || undefined;
    const processEnvValue = processEnvironment[envName]?.trim() || undefined;
    const tagValue = preferredTag(stimulus, tagName, legacyTagName);
    const value = tagValue
        ?? stimulusEnvValue
        ?? optionEnvValue
        ?? processEnvValue
        ?? fallback?.trim()
        ?? undefined;
    if (!value) {
        throw new Error(
            `Explicit stimulus tag "${tagName}" or ${envName} in the stimulus/process environment is required.`,
        );
    }

    if (allowed && !allowed.includes(value)) {
        throw new Error(`Unknown ${tagName} "${value}"; expected one of: ${allowed.join(', ')}.`);
    }
    return value as T extends readonly string[] ? T[number] : string;
}

function preferredTag(
    stimulus: Stimulus,
    tagName: string,
    legacyTagName?: string,
): string | undefined {
    const value = optionalTag(stimulus, tagName);
    if (!legacyTagName) {
        return value;
    }
    const legacyValue = optionalTag(stimulus, legacyTagName);
    if (value !== undefined && legacyValue !== undefined && value !== legacyValue) {
        throw new Error(
            `Stimulus tag "${tagName}" conflicts with legacy tag "${legacyTagName}".`,
        );
    }
    return value ?? legacyValue;
}

function optionalTag(stimulus: Stimulus, name: string): string | undefined {
    const value = stimulus.tags?.[name];
    if (value === undefined) {
        return undefined;
    }
    if (Array.isArray(value)) {
        if (value.length !== 1 || !value[0]?.trim()) {
            throw new Error(`Stimulus tag "${name}" must contain exactly one non-empty value.`);
        }
        return value[0].trim();
    }
    if (!value.trim()) {
        throw new Error(`Stimulus tag "${name}" must be non-empty.`);
    }
    return value.trim();
}

async function readNativeSummary(summaryPath: string): Promise<NativeSummary> {
    const value: unknown = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
    if (!value || typeof value !== 'object') {
        throw new Error(`Native summary at ${summaryPath} is not a JSON object.`);
    }
    return value as NativeSummary;
}

function validateNativeSummary(
    summary: NativeSummary,
    selection: VallyAcaTrialSelection,
): AttemptEvidence {
    if (summary.evaluationArm !== selection.arm) {
        throw new Error(`Native arm "${summary.evaluationArm}" does not match requested arm "${selection.arm}".`);
    }
    if (summary.through !== selection.endpoint) {
        throw new Error(`Native endpoint "${summary.through}" does not match requested endpoint "${selection.endpoint}".`);
    }
    if (summary.attempts !== undefined && summary.attempts !== 1) {
        throw new Error(`Native runner reported ${summary.attempts} attempts; exactly one is required.`);
    }
    if (summary.concurrency !== undefined && summary.concurrency !== 1) {
        throw new Error(`Native runner reported concurrency ${summary.concurrency}; exactly one is required.`);
    }
    if (!Array.isArray(summary.results) || summary.results.length !== 1) {
        throw new Error('Native runner must return exactly one attempt result.');
    }
    const summaryRequestedModels = [
        ...(summary.requestedModel ? [summary.requestedModel] : []),
        ...(summary.requestedModels ?? []),
    ];
    if (summaryRequestedModels.some(model => model !== selection.model)) {
        throw new Error(`Native summary requested a model other than "${selection.model}".`);
    }
    if ((summary.observedModels ?? []).some(model => model !== selection.model)) {
        throw new Error(`Native summary observed a model other than "${selection.model}".`);
    }
    const attempt = summary.results[0];
    if (attempt.evaluationArm !== undefined && attempt.evaluationArm !== selection.arm) {
        throw new Error(
            `Native attempt arm "${attempt.evaluationArm}" does not match requested arm "${selection.arm}".`,
        );
    }
    if (attempt.scenarioId !== selection.scenarioId) {
        throw new Error(
            `Native scenario "${attempt.scenarioId}" does not match requested scenario "${selection.scenarioId}".`,
        );
    }
    if (attempt.attempt !== 1) {
        throw new Error(`Native attempt index ${attempt.attempt} is invalid; expected 1.`);
    }
    if (
        !attempt.runId
        || attempt.runId === '.'
        || attempt.runId === '..'
        || path.basename(attempt.runId) !== attempt.runId
    ) {
        throw new Error('Native runId must be a non-empty single path segment.');
    }
    return attempt;
}

function assertObservedModel(attempt: AttemptEvidence, requestedModel: string): void {
    if (attempt.requestedModel !== requestedModel || attempt.model !== requestedModel) {
        throw new Error(
            `Native requested/model identity does not match requested model "${requestedModel}".`,
        );
    }
    const observed = attempt.observedModels ?? [];
    if (!observed.length) {
        throw new Error(`Native run did not observe requested model "${requestedModel}".`);
    }
    const mismatches = observed.filter(model => model !== requestedModel);
    if (mismatches.length) {
        throw new Error(
            `Native run observed model(s) ${[...new Set(mismatches)].join(', ')}`
            + ` instead of requested model "${requestedModel}".`,
        );
    }
}

async function mirrorWorkspace(source: string, destination: string): Promise<void> {
    const resolved = path.resolve(destination);
    if (resolved === path.parse(resolved).root) {
        throw new Error('Refusing to replace a filesystem root with the generated workspace.');
    }
    await fs.mkdir(resolved, { recursive: true });
    const existing = await fs.readdir(resolved);
    await Promise.all(existing.map(entry =>
        fs.rm(path.join(resolved, entry), { recursive: true, force: true })));
    await fs.cp(source, resolved, { recursive: true, force: true });
}

async function assertFile(filePath: string, description: string): Promise<void> {
    const stat = await fs.stat(filePath).catch(() => undefined);
    if (!stat?.isFile()) {
        throw new Error(`Native ${description} is missing at ${filePath}.`);
    }
}

async function assertDirectory(directory: string, description: string): Promise<void> {
    const stat = await fs.stat(directory).catch(() => undefined);
    if (!stat?.isDirectory()) {
        throw new Error(`Native ${description} is missing at ${directory}.`);
    }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
