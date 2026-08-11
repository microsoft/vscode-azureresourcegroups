/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { parse } from 'jsonc-parser';
import type { CorAgentRunResult } from '../../src/utils/copilotOnRails/agentExecution/CorAgentExecutor';
import {
    BaselineAgentExecutor,
    BaselineCopilotSdkExecutor,
    getBaselineStateDirectory,
} from './BaselineCopilotSdkExecutor';
import {
    isLocalRuntimeInfrastructureFailureCode,
    SandboxLocalRuntimeValidationResult,
    SandboxLocalRuntimeValidator,
} from './SandboxLocalRuntimeValidator';
import {
    isSandboxInfrastructureFailureCode,
    SandboxProjectValidationResult,
    SandboxProjectValidator,
} from './SandboxProjectValidator';
import { validateIntegrationOutput } from './artifacts/integrationOutput';
import { ArtifactValidationResult } from './artifacts/validationTypes';
import {
    createAgentRepairBudget,
    shouldValidateIntegrationOutput,
    tryConsumeAgentRepair,
    validatePinnedModel,
} from './evaluationParity';
import {
    EvaluationDefinitionProvenance,
    computeEvaluationDefinition,
} from './evaluationDefinition';
import {
    CorEvaluationScenario,
    LocalAcceptanceProbe,
    loadScenarios,
} from './scenario';

export type BaselineScenario = CorEvaluationScenario & { baselinePrompt: string };
export type BaselineThrough = 'scaffold' | 'local';
export type BaselineFailureCategory = 'product_failure' | 'harness_failure' | 'infrastructure_failure';

export interface BaselineRunOptions {
    attempts: number;
    concurrency: number;
    dryRun: boolean;
    through: BaselineThrough;
    model?: string;
    scenarioId?: string;
    outputDirectory?: string;
}

export interface BaselineStageResult {
    name: 'scaffold' | 'integration' | 'build' | 'repair' | 'local-repair' | 'local-runtime';
    agentRun?: CorAgentRunResult;
    validation?: ArtifactValidationResult;
    buildValidation?: SandboxProjectValidationResult;
    localRuntimeValidation?: SandboxLocalRuntimeValidationResult;
}

export interface BaselineAttemptResult {
    schemaVersion: '1';
    evaluationArm: 'baseline-controlled';
    runId: string;
    scenarioId: string;
    attempt: number;
    candidateCommit: string;
    agentAssetsHash: 'not-applicable:baseline-controlled';
    evaluationDefinition?: EvaluationDefinitionProvenance;
    model: string;
    requestedModel: string;
    observedModels: string[];
    outcome: 'autonomous_success' | 'failed';
    failedStage?: BaselineStageResult['name'] | 'harness';
    failureCode?: string;
    failureCategory?: BaselineFailureCategory;
    error?: string;
    durationMs: number;
    agentRetries: number;
    stages: BaselineStageResult[];
    sourceProvenance: BaselineSourceProvenance;
}

export interface BaselineSourceProvenance {
    promptSource: string;
    promptField: 'baselinePrompt';
    agentIdentity: 'copilot-sdk-generic';
    workspaceSeed: 'empty';
    railsAssetsInjected: false;
    customToolsInjected: false;
    permissionPolicy: 'workspace-files-only';
    localPlanMetadata?: 'evaluator-adapter-from-vscode-and-acceptance';
}

interface ProjectValidatorLike {
    validate(workspace: string, scenario: CorEvaluationScenario): Promise<SandboxProjectValidationResult>;
}

interface LocalRuntimeValidatorLike {
    validate(
        workspace: string,
        scenario: CorEvaluationScenario,
        planContent: string,
    ): Promise<SandboxLocalRuntimeValidationResult>;
}

export interface BaselineAttemptDependencies {
    executor: BaselineAgentExecutor;
    projectValidator: ProjectValidatorLike;
    localRuntimeValidator: LocalRuntimeValidatorLike;
}

export interface BaselineAttemptInput extends BaselineAttemptDependencies {
    repoRoot: string;
    outputDirectory: string;
    workspacesRoot: string;
    scenario: BaselineScenario;
    attempt: number;
    candidateCommit: string;
    model: string;
    through: BaselineThrough;
    evaluationDefinition?: EvaluationDefinitionProvenance;
}

const baselineAssetsHash = 'not-applicable:baseline-controlled' as const;
const maxEvidenceLength = 16_000;

async function main(): Promise<void> {
    const repoRoot = process.cwd();
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        process.stdout.write(baselineUsage);
        return;
    }
    const options = parseBaselineArgs(args);
    const scenarios = selectBaselineScenarios(
        await loadScenarios(path.join(repoRoot, 'evals', 'scenarios')),
        options.scenarioId,
    );
    if (options.dryRun) {
        process.stdout.write(`Validated ${scenarios.length} baseline scenarios without model calls.\n`);
        return;
    }

    const model = options.model as string;
    const started = new Date();
    const outputDirectory = path.resolve(options.outputDirectory
        ?? path.join(repoRoot, 'evals', 'results', `baseline-${started.toISOString().replace(/[:.]/g, '-')}`));
    const workspacesRoot = path.join(outputDirectory, '.workspaces');
    await fs.mkdir(workspacesRoot, { recursive: true });
    const candidateCommit = getCandidateCommit(repoRoot);
    const evaluationDefinition = await computeEvaluationDefinition(
        repoRoot,
        scenarios.map(scenario => scenario.id),
    );
    const dependencies: BaselineAttemptDependencies = {
        executor: new BaselineCopilotSdkExecutor(),
        projectValidator: new SandboxProjectValidator(repoRoot),
        localRuntimeValidator: new SandboxLocalRuntimeValidator(repoRoot),
    };
    const results: BaselineAttemptResult[] = [];
    const jobs = scenarios.flatMap(scenario =>
        Array.from({ length: options.attempts }, (_, index) => ({ scenario, attempt: index + 1 })));

    await runWithConcurrency(jobs, options.concurrency, async ({ scenario, attempt }) => {
        let result: BaselineAttemptResult;
        try {
            result = await runBaselineAttempt({
                ...dependencies,
                repoRoot,
                outputDirectory,
                workspacesRoot,
                scenario,
                attempt,
                candidateCommit,
                evaluationDefinition,
                model,
                through: options.through,
            });
        } catch (error) {
            result = createHarnessFailureResult(
                scenario,
                attempt,
                candidateCommit,
                model,
                options.through,
                evaluationDefinition,
                error,
            );
        }
        results.push(result);
        process.stdout.write(`${result.outcome === 'autonomous_success' ? 'PASS' : 'FAIL'} ${scenario.id} attempt ${attempt}\n`);
    });
    results.sort((left, right) =>
        left.scenarioId.localeCompare(right.scenarioId) || left.attempt - right.attempt);
    await fs.rm(workspacesRoot, { recursive: true, force: true });

    const summary = {
        schemaVersion: '1',
        evaluationArm: 'baseline-controlled',
        startedAt: started.toISOString(),
        completedAt: new Date().toISOString(),
        candidateCommit,
        agentAssetsHash: baselineAssetsHash,
        evaluationDefinitions: [evaluationDefinition],
        requestedModel: model,
        observedModels: unique(results.flatMap(result => result.observedModels)),
        through: options.through,
        concurrency: options.concurrency,
        attempts: results.length,
        successes: results.filter(result => result.outcome === 'autonomous_success').length,
        failures: results.filter(result => result.outcome === 'failed').length,
        sourceProvenance: createSourceProvenance('*', options.through),
        results,
    };
    await fs.writeFile(path.join(outputDirectory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    process.stdout.write(`Results: ${outputDirectory}\n`);
    if (summary.failures) {
        process.exitCode = 1;
    }
}

export async function runBaselineAttempt(input: BaselineAttemptInput): Promise<BaselineAttemptResult> {
    const started = Date.now();
    const runId = `baseline-${input.scenario.id}-${input.attempt}-${started}`;
    const resultDirectory = path.join(input.outputDirectory, runId);
    await fs.mkdir(resultDirectory, { recursive: true });
    const workspace = await fs.mkdtemp(path.join(input.workspacesRoot, `${input.scenario.id}-${input.attempt}-`));
    const stages: BaselineStageResult[] = [];
    const observedModels = new Set<string>();
    const repairBudget = createAgentRepairBudget(input.scenario.validation.maxAgentRetries);
    let result: BaselineAttemptResult;

    try {
        const initialRun = await input.executor.run({
            prompt: input.scenario.baselinePrompt,
            workingDirectory: workspace,
            model: input.model,
            timeoutMs: timeoutMs(input.scenario),
        });
        stages.push({ name: 'scaffold', agentRun: initialRun });
        recordAndAssertModel(initialRun, input.model, observedModels, 'scaffold');
        assertAgentCompleted(initialRun, 'scaffold');

        while (true) {
            const projectValidation = await input.projectValidator.validate(workspace, input.scenario);
            stages.push({ name: 'build', buildValidation: projectValidation });
            if (isSandboxInfrastructureFailureCode(projectValidation.failureCode)) {
                throw new BaselineStageFailure(
                    'build',
                    projectValidation.failureCode as string,
                    projectValidation.error ?? 'Sandbox project validation infrastructure failed.',
                );
            }
            if (projectValidation.outcome !== 'passed') {
                const repairAttempt = tryConsumeAgentRepair(repairBudget);
                if (repairAttempt === undefined) {
                    throw new BaselineStageFailure(
                        'build',
                        projectValidation.failureCode ?? 'buildValidationFailed',
                        projectValidation.error ?? 'Generated project validation failed.',
                    );
                }
                const repairRun = await input.executor.run({
                    prompt: createBaselineRepairPrompt(repairAttempt, {
                        stage: 'build',
                        project: sanitizeProjectValidation(projectValidation),
                    }),
                    workingDirectory: workspace,
                    model: input.model,
                    timeoutMs: timeoutMs(input.scenario),
                });
                stages.push({ name: 'repair', agentRun: repairRun });
                recordAndAssertModel(repairRun, input.model, observedModels, 'repair');
                assertAgentCompleted(repairRun, 'repair');
                continue;
            }

            if (!shouldValidateIntegrationOutput(input.through)) {
                break;
            }

            const integrationValidation = await validateIntegrationOutput(workspace, {
                hasFrontend: input.scenario.tags.frontend !== 'none',
            });
            stages.push({ name: 'integration', validation: integrationValidation });
            if (!integrationValidation.valid) {
                const repairAttempt = tryConsumeAgentRepair(repairBudget);
                if (repairAttempt === undefined) {
                    throw new BaselineStageFailure(
                        'integration',
                        'integrationValidationFailed',
                        integrationValidation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '),
                    );
                }
                const repairRun = await input.executor.run({
                    prompt: createBaselineRepairPrompt(repairAttempt, {
                        stage: 'integration',
                        integrationIssues: integrationValidation.issues,
                    }),
                    workingDirectory: workspace,
                    model: input.model,
                    timeoutMs: timeoutMs(input.scenario),
                });
                stages.push({ name: 'repair', agentRun: repairRun });
                recordAndAssertModel(repairRun, input.model, observedModels, 'repair');
                assertAgentCompleted(repairRun, 'repair');
                continue;
            }

            const planMetadata = await createLocalPlanMetadata(workspace, input.scenario);
            const localValidation = await input.localRuntimeValidator.validate(
                workspace,
                input.scenario,
                planMetadata,
            );
            stages.push({ name: 'local-runtime', localRuntimeValidation: localValidation });
            if (localValidation.outcome === 'passed') {
                break;
            }
            if (isLocalRuntimeInfrastructureFailureCode(localValidation.failureCode)) {
                throw new BaselineStageFailure(
                    'local-runtime',
                    localValidation.failureCode as string,
                    localValidation.error ?? 'Local runtime validation infrastructure failed.',
                );
            }
            const repairAttempt = tryConsumeAgentRepair(repairBudget);
            if (repairAttempt === undefined) {
                throw new BaselineStageFailure(
                    'local-runtime',
                    localValidation.failureCode ?? 'localRuntimeValidationFailed',
                    localValidation.error ?? 'Generated local-development setup failed validation.',
                );
            }
            const repairRun = await input.executor.run({
                prompt: createBaselineRepairPrompt(repairAttempt, {
                    stage: 'local-runtime',
                    localRuntime: sanitizeLocalValidation(localValidation),
                }),
                workingDirectory: workspace,
                model: input.model,
                timeoutMs: timeoutMs(input.scenario),
            });
            stages.push({ name: 'local-repair', agentRun: repairRun });
            recordAndAssertModel(repairRun, input.model, observedModels, 'local-repair');
            assertAgentCompleted(repairRun, 'local-repair');
        }

        result = createAttemptResult(input, runId, started, stages, observedModels, repairBudget.usedRetries, {
            outcome: 'autonomous_success',
        });
    } catch (error) {
        const failure = classifyFailure(error);
        result = createAttemptResult(input, runId, started, stages, observedModels, repairBudget.usedRetries, {
            outcome: 'failed',
            failedStage: failure.stage,
            failureCode: failure.code,
            failureCategory: failure.category,
            error: getErrorMessage(error),
        });
    }

    const finalizationErrors: string[] = [];
    try {
        await fs.cp(workspace, path.join(resultDirectory, 'workspace'), { recursive: true, force: true });
    } catch (error) {
        finalizationErrors.push(`Workspace archival failed: ${getErrorMessage(error)}`);
    }
    try {
        await fs.rm(workspace, { recursive: true, force: true });
    } catch (error) {
        finalizationErrors.push(`Workspace cleanup failed: ${getErrorMessage(error)}`);
    }
    try {
        await fs.rm(getBaselineStateDirectory({ workingDirectory: workspace }), { recursive: true, force: true });
    } catch (error) {
        finalizationErrors.push(`SDK state cleanup failed: ${getErrorMessage(error)}`);
    }
    if (finalizationErrors.length) {
        result = {
            ...result,
            outcome: 'failed',
            failedStage: 'harness',
            failureCode: 'resultFinalizationFailed',
            failureCategory: 'harness_failure',
            error: [result.error, ...finalizationErrors].filter(Boolean).join(' '),
        };
    }
    try {
        await fs.writeFile(path.join(resultDirectory, 'run-result.json'), JSON.stringify(result, null, 2) + '\n');
    } catch (error) {
        result = {
            ...result,
            outcome: 'failed',
            failedStage: 'harness',
            failureCode: 'resultWriteFailed',
            failureCategory: 'harness_failure',
            error: [result.error, `Result write failed: ${getErrorMessage(error)}`].filter(Boolean).join(' '),
        };
    }
    return result;
}

export function parseBaselineArgs(args: string[]): BaselineRunOptions {
    const options: BaselineRunOptions = {
        attempts: 1,
        concurrency: 1,
        dryRun: false,
        through: 'scaffold',
    };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        switch (arg) {
            case '--attempts':
                options.attempts = Number(requireValue(args, ++index, arg));
                break;
            case '--concurrency':
                options.concurrency = Number(requireValue(args, ++index, arg));
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--through': {
                const value = requireValue(args, ++index, arg);
                if (value !== 'scaffold' && value !== 'local') {
                    throw new Error('--through must be "scaffold" or "local".');
                }
                options.through = value;
                break;
            }
            case '--model':
                options.model = requireValue(args, ++index, arg);
                break;
            case '--scenario':
                options.scenarioId = requireValue(args, ++index, arg);
                break;
            case '--output':
                options.outputDirectory = requireValue(args, ++index, arg);
                break;
            default:
                throw new Error(`Unknown argument "${arg}".`);
        }
    }
    if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 50) {
        throw new Error('--attempts must be an integer from 1 to 50.');
    }
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 10) {
        throw new Error('--concurrency must be an integer from 1 to 10.');
    }
    if (!options.dryRun && !options.model) {
        throw new Error('--model is required for a real baseline run; ambient model defaults are not permitted.');
    }
    if (options.model !== undefined && !options.model.trim()) {
        throw new Error('--model must be a non-empty model id.');
    }
    return options;
}

export function selectBaselineScenarios(
    scenarios: CorEvaluationScenario[],
    scenarioId?: string,
): BaselineScenario[] {
    const selected = scenarios.filter(scenario => !scenarioId || scenario.id === scenarioId);
    if (!selected.length) {
        throw new Error(scenarioId ? `Unknown scenario "${scenarioId}".` : 'No evaluation scenarios found.');
    }
    for (const scenario of selected) {
        const baselinePrompt = (scenario as Partial<BaselineScenario>).baselinePrompt;
        if (typeof baselinePrompt !== 'string' || !baselinePrompt.trim()) {
            throw new Error(`Scenario "${scenario.id}" must define a non-empty baselinePrompt.`);
        }
    }
    return selected as BaselineScenario[];
}

/**
 * Adapts evaluator-owned acceptance targets and generated VS Code launch configurations to the
 * metadata shape consumed by SandboxLocalRuntimeValidator. Nothing is written to the candidate.
 */
export async function createLocalPlanMetadata(
    workspace: string,
    scenario: CorEvaluationScenario,
): Promise<string> {
    const launchPath = path.join(workspace, '.vscode', 'launch.json');
    const rawConfigurations = await readLaunchConfigurations(launchPath);
    const configurations = rawConfigurations.flatMap((value, index) => {
        if (!value || typeof value !== 'object') {
            return [];
        }
        const configuration = value as Record<string, unknown>;
        if (typeof configuration.name !== 'string' || typeof configuration.type !== 'string') {
            return [];
        }
        const runtime = launchTypeToRuntime(configuration.type);
        if (!runtime) {
            return [];
        }
        return [{
            index,
            name: configuration.name,
            runtime,
            serviceRoot: inferServiceRoot(configuration),
        }];
    });
    const targets = unique((scenario.acceptance?.local?.probes ?? []).map(probe => probe.target));
    const selected = selectConfigurationsForTargets(configurations, targets);
    const rows = selected.map(({ target, configuration }) =>
        `| [x] | ${escapeTable(configuration.name)} | ${escapeTable(configuration.serviceRoot)} | ${targetLabel(target)} | ${configuration.runtime} |`);
    return [
        '# Evaluator-owned Local Debug Metadata',
        '',
        '## Debug Configurations',
        '',
        '| Generate | Debug Config Name | Service Root | Project Type | Runtime |',
        '| --- | --- | --- | --- | --- |',
        ...rows,
        '',
    ].join('\n');
}

async function readLaunchConfigurations(launchPath: string): Promise<unknown[]> {
    try {
        const launch = parse(await fs.readFile(launchPath, 'utf8')) as { configurations?: unknown };
        return Array.isArray(launch?.configurations) ? launch.configurations : [];
    } catch {
        return [];
    }
}

export function createBaselineRepairPrompt(repairAttempt: number, evidence: unknown): string {
    return [
        `Repair attempt ${repairAttempt}.`,
        'Automated validation ran the generated project in an isolated environment and returned the sanitized failure evidence below.',
        'Inspect the existing workspace files, fix only the root cause using workspace file tools, and stop after writing the edits.',
        'Do not run commands, access the network, or delegate.',
        '```json',
        sanitizeRepairEvidence(JSON.stringify(evidence, null, 2)),
        '```',
    ].join('\n');
}

export function sanitizeRepairEvidence(value: string): string {
    const redacted = value
        .replace(/(AccountKey=)[^;"\s]+/gi, '$1[REDACTED]')
        .replace(/((?:password|passwd|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
        .replace(/(Authorization["']?\s*:\s*["']?)[^\r\n"']+/gi, '$1[REDACTED]');
    return redacted.length <= maxEvidenceLength
        ? redacted
        : `${redacted.slice(0, maxEvidenceLength)}\n[truncated]`;
}

function selectConfigurationsForTargets(
    configurations: Array<{ index: number; name: string; runtime: string; serviceRoot: string }>,
    targets: LocalAcceptanceProbe['target'][],
): Array<{
    target: LocalAcceptanceProbe['target'];
    configuration: { index: number; name: string; runtime: string; serviceRoot: string };
}> {
    const remaining = new Set(configurations.map(configuration => configuration.index));
    return targets.flatMap(target => {
        const ranked = configurations
            .filter(configuration => remaining.has(configuration.index))
            .map(configuration => ({ configuration, score: configurationScore(configuration, target, targets.length) }))
            .sort((left, right) => right.score - left.score || left.configuration.index - right.configuration.index);
        const selected = ranked[0]?.configuration;
        if (!selected) {
            return [];
        }
        remaining.delete(selected.index);
        return [{ target, configuration: selected }];
    });
}

function configurationScore(
    configuration: { name: string; serviceRoot: string },
    target: LocalAcceptanceProbe['target'],
    targetCount: number,
): number {
    const value = `${configuration.name} ${configuration.serviceRoot}`.toLowerCase();
    const terms: Record<LocalAcceptanceProbe['target'], string[]> = {
        backend: ['backend', 'server', 'api', 'function'],
        frontend: ['frontend', 'client', 'web', 'ui'],
        worker: ['worker', 'background', 'queue'],
    };
    const otherTerms = Object.entries(terms)
        .filter(([candidate]) => candidate !== target)
        .flatMap(([, values]) => values);
    return terms[target].reduce((score, term) => score + (value.includes(term) ? 10 : 0), 0)
        - otherTerms.reduce((score, term) => score + (value.includes(term) ? 10 : 0), 0)
        + (targetCount === 1 ? 1 : 0);
}

function inferServiceRoot(configuration: Record<string, unknown>): string {
    if (typeof configuration.cwd === 'string') {
        const cwd = relativeWorkspacePath(configuration.cwd);
        if (cwd !== undefined) {
            return cwd;
        }
    }
    if (typeof configuration.program === 'string') {
        const program = relativeWorkspacePath(configuration.program);
        if (program !== undefined) {
            const parts = program === '.' ? [] : program.split('/');
            const outputIndex = parts.findIndex(part => ['src', 'dist', 'out', 'bin'].includes(part.toLowerCase()));
            const directoryParts = outputIndex >= 0
                ? parts.slice(0, outputIndex)
                : parts.slice(0, -1);
            return directoryParts.join('/') || '.';
        }
    }
    return '.';
}

function relativeWorkspacePath(value: string): string | undefined {
    const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '');
    const workspaceFolder = '$' + '{workspaceFolder}';
    if (normalized === workspaceFolder) {
        return '.';
    }
    const prefix = `${workspaceFolder}/`;
    return normalized.startsWith(prefix) ? normalized.slice(prefix.length) || '.' : undefined;
}

function launchTypeToRuntime(type: string): string | undefined {
    const normalized = type.toLowerCase();
    if (['node', 'pwa-node', 'msedge', 'pwa-msedge', 'chrome', 'pwa-chrome'].includes(normalized)) {
        return 'Node.js';
    }
    if (normalized.includes('python') || normalized === 'debugpy') {
        return 'Python';
    }
    if (normalized === 'coreclr' || normalized.includes('dotnet')) {
        return '.NET';
    }
    return undefined;
}

function targetLabel(target: LocalAcceptanceProbe['target']): string {
    return target === 'frontend' ? 'Frontend' : target === 'worker' ? 'Worker' : 'Backend';
}

function escapeTable(value: string): string {
    return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function sanitizeProjectValidation(validation: SandboxProjectValidationResult): unknown {
    const failedCommand = validation.commands.find(command => !command.success);
    return {
        failureCode: validation.failureCode,
        error: validation.error,
        failedCommand: failedCommand && {
            ecosystem: failedCommand.ecosystem,
            relativeDirectory: failedCommand.relativeDirectory,
            command: failedCommand.command,
            stdout: failedCommand.stdout,
            stderr: failedCommand.stderr,
        },
    };
}

function sanitizeLocalValidation(validation: SandboxLocalRuntimeValidationResult): unknown {
    const failedCommand = validation.commands.find(command => !command.success);
    return {
        failureCode: validation.failureCode,
        error: validation.error,
        failedCommand: failedCommand && {
            name: failedCommand.name,
            command: failedCommand.command,
            stdout: failedCommand.stdout,
            stderr: failedCommand.stderr,
        },
        probes: validation.probes,
        browserChecks: validation.browserChecks,
    };
}

function recordAndAssertModel(
    run: CorAgentRunResult,
    requestedModel: string,
    observedModels: Set<string>,
    stage: BaselineStageResult['name'],
): void {
    for (const model of run.usage.models) {
        observedModels.add(model);
    }
    const failure = validatePinnedModel(requestedModel, run.usage.models);
    if (failure) {
        throw new BaselineStageFailure(stage, failure.code, failure.message);
    }
}

function assertAgentCompleted(run: CorAgentRunResult, stage: BaselineStageResult['name']): void {
    if (run.outcome !== 'completed') {
        throw new BaselineStageFailure(
            stage,
            run.errors.some(error => error.startsWith('SDK cleanup:')) ? 'agentCleanupFailed' : 'agentRunFailed',
            run.errors.join('; ') || `Agent outcome was ${run.outcome}.`,
        );
    }
}

function createAttemptResult(
    input: BaselineAttemptInput,
    runId: string,
    started: number,
    stages: BaselineStageResult[],
    observedModels: Set<string>,
    agentRetries: number,
    outcome: Pick<
        BaselineAttemptResult,
        'outcome' | 'failedStage' | 'failureCode' | 'failureCategory' | 'error'
    >,
): BaselineAttemptResult {
    return {
        schemaVersion: '1',
        evaluationArm: 'baseline-controlled',
        runId,
        scenarioId: input.scenario.id,
        attempt: input.attempt,
        candidateCommit: input.candidateCommit,
        agentAssetsHash: baselineAssetsHash,
        evaluationDefinition: input.evaluationDefinition,
        model: input.model,
        requestedModel: input.model,
        observedModels: [...observedModels],
        durationMs: Date.now() - started,
        agentRetries,
        stages,
        sourceProvenance: createSourceProvenance(input.scenario.id, input.through),
        ...outcome,
    };
}

function createHarnessFailureResult(
    scenario: BaselineScenario,
    attempt: number,
    candidateCommit: string,
    model: string,
    through: BaselineThrough,
    evaluationDefinition: EvaluationDefinitionProvenance | undefined,
    error: unknown,
): BaselineAttemptResult {
    return {
        schemaVersion: '1',
        evaluationArm: 'baseline-controlled',
        runId: `baseline-${scenario.id}-${attempt}-${Date.now()}`,
        scenarioId: scenario.id,
        attempt,
        candidateCommit,
        agentAssetsHash: baselineAssetsHash,
        evaluationDefinition,
        model,
        requestedModel: model,
        observedModels: [],
        outcome: 'failed',
        failedStage: 'harness',
        failureCode: 'attemptExecutionFailed',
        failureCategory: 'harness_failure',
        error: getErrorMessage(error),
        durationMs: 0,
        agentRetries: 0,
        stages: [],
        sourceProvenance: createSourceProvenance(scenario.id, through),
    };
}

function createSourceProvenance(scenarioId: string, through: BaselineThrough): BaselineSourceProvenance {
    return {
        promptSource: scenarioId === '*' ? 'evals/scenarios/*.json#baselinePrompt' : `evals/scenarios/${scenarioId}.json#baselinePrompt`,
        promptField: 'baselinePrompt',
        agentIdentity: 'copilot-sdk-generic',
        workspaceSeed: 'empty',
        railsAssetsInjected: false,
        customToolsInjected: false,
        permissionPolicy: 'workspace-files-only',
        ...(through === 'local' && {
            localPlanMetadata: 'evaluator-adapter-from-vscode-and-acceptance' as const,
        }),
    };
}

function classifyFailure(error: unknown): {
    stage: BaselineAttemptResult['failedStage'];
    code: string;
    category: BaselineFailureCategory;
} {
    if (!(error instanceof BaselineStageFailure)) {
        return { stage: 'harness', code: 'harnessError', category: 'harness_failure' };
    }
    if (['modelMismatch', 'modelNotObserved', 'acceptanceSpecMissing', 'agentCleanupFailed'].includes(error.code)) {
        return { stage: error.stage, code: error.code, category: 'harness_failure' };
    }
    if (isSandboxInfrastructureFailureCode(error.code) || isLocalRuntimeInfrastructureFailureCode(error.code)) {
        return { stage: error.stage, code: error.code, category: 'infrastructure_failure' };
    }
    return { stage: error.stage, code: error.code, category: 'product_failure' };
}

export class BaselineStageFailure extends Error {
    public constructor(
        public readonly stage: BaselineStageResult['name'],
        public readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

function timeoutMs(scenario: CorEvaluationScenario): number {
    return scenario.validation.timeoutMinutes * 60 * 1000;
}

function getCandidateCommit(repoRoot: string): string {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function requireValue(args: string[], index: number, option: string): string {
    const value = args[index];
    if (!value) {
        throw new Error(`${option} requires a value.`);
    }
    return value;
}

async function runWithConcurrency<T>(
    values: T[],
    concurrency: number,
    operation: (value: T) => Promise<void>,
): Promise<void> {
    let nextIndex = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (nextIndex < values.length) {
            await operation(values[nextIndex++]);
        }
    }));
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export const baselineUsage = `Usage: npm run eval:cor:baseline -- [options]

Options:
  --dry-run                 Validate selected scenario prompts without model calls
  --model <id>              Required model pin for a real run
  --scenario <id>           Run one scenario (default: all)
  --attempts <1-50>         Attempts per scenario (default: 1)
  --concurrency <1-10>      Concurrent attempts (default: 1)
  --through <scaffold|local>
  --output <directory>      Result directory
  -h, --help                Show this help
`;

if (require.main === module) {
    void main().catch(error => {
        console.error(getErrorMessage(error));
        process.exitCode = 1;
    });
}
