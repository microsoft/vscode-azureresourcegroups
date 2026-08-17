/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { CopilotSdkAgentExecutor } from './CopilotSdkAgentExecutor';
import {
    isLocalRuntimeInfrastructureFailureCode,
    SandboxLocalRuntimeValidator,
} from './SandboxLocalRuntimeValidator';
import {
    isSandboxInfrastructureFailureCode,
    SandboxProjectValidator,
} from './SandboxProjectValidator';
import {
    computeAgentAssetsHash,
    prepareAgentWorkspace,
} from './agentAssets';
import {
    EvaluationFailureCategory,
    EvaluationAttemptResult,
    EvaluationStageResult,
    StageFailure,
    observedModels,
    runIntegrationStages,
    runLocalDevelopmentStages,
    runProjectValidationStages,
} from './run';
import {
    createAgentRepairBudget,
    validatePinnedModel,
} from './evaluationParity';
import {
    computeEvaluationDefinition,
    isEvaluationDefinitionProvenance,
    sameEvaluationDefinition,
} from './evaluationDefinition';
import { loadScenarios } from './scenario';

interface ResumeOptions {
    workspace: string;
    scenarioId: string;
    outputDirectory: string;
    model: string;
    validateBuild: boolean;
    sourceResult?: string;
    regenerateLocal: boolean;
}

interface ResumeSourceResult extends EvaluationAttemptResult {
    resume?: unknown;
}

async function main(): Promise<void> {
    const repoRoot = process.cwd();
    const options = parseResumeArgs(process.argv.slice(2));
    const sourceWorkspace = path.resolve(options.workspace);
    const scenario = (await loadScenarios(path.join(repoRoot, 'evals', 'scenarios')))
        .find(value => value.id === options.scenarioId);
    if (!scenario) {
        throw new Error(`Unknown scenario "${options.scenarioId}".`);
    }
    await fs.access(path.join(sourceWorkspace, '.azure', 'project-plan.md'));
    if (
        !options.regenerateLocal
        && await fileExists(path.join(sourceWorkspace, '.azure', 'vscode-debug-plan.md'))
    ) {
        throw new Error('The source workspace already contains local-debug output. Resume from a scaffold-stage archive.');
    }
    const sourceResultPath = path.resolve(options.sourceResult
        ?? path.join(path.dirname(sourceWorkspace), 'run-result.json'));
    const sourceResult = await readSourceResult(sourceResultPath, scenario.id);

    const startedAt = new Date();
    const runId = `${scenario.id}-local-resume-${startedAt.getTime()}`;
    const resultDirectory = path.join(path.resolve(options.outputDirectory), runId);
    const workspace = path.join(resultDirectory, 'workspace');
    await fs.mkdir(resultDirectory, { recursive: true });
    await fs.cp(sourceWorkspace, workspace, { recursive: true, force: true });
    if (options.regenerateLocal) {
        await Promise.all([
            fs.rm(path.join(workspace, '.azure', 'vscode-debug-plan.md'), { force: true }),
            fs.rm(path.join(workspace, '.vscode'), { force: true, recursive: true }),
        ]);
    }
    await prepareAgentWorkspace(repoRoot, workspace);

    const stages: EvaluationStageResult[] = [...sourceResult.stages];
    const model = options.model;
    const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
    }).trim();
    const agentAssetsHash = await computeAgentAssetsHash(repoRoot);
    if (sourceResult.candidateCommit !== candidateCommit || sourceResult.agentAssetsHash !== agentAssetsHash) {
        throw new Error(
            'Resume source commit and agent-assets provenance must match the current treatment checkout.',
        );
    }
    const currentEvaluationDefinition = await computeEvaluationDefinition(
        repoRoot,
        sourceResult.evaluationDefinition?.scenarioIds ?? [scenario.id],
    );
    if (
        sourceResult.evaluationDefinition
        && !sameEvaluationDefinition(sourceResult.evaluationDefinition, currentEvaluationDefinition)
    ) {
        throw new Error('Resume source evaluation definition must exactly match the current evaluator and product contracts.');
    }
    const evaluationDefinition = sourceResult.evaluationDefinition
        ? currentEvaluationDefinition
        : undefined;
    let outcome: 'autonomous_success' | 'failed' = 'autonomous_success';
    let failedStage: EvaluationStageResult['name'] | 'harness' | undefined;
    let failureCode: string | undefined;
    let failureCategory: EvaluationFailureCategory | undefined;
    let errorMessage: string | undefined;
    const repairBudget = createAgentRepairBudget(
        scenario.validation.maxAgentRetries,
        sourceResult.agentRetries,
    );

    try {
        assertSourceModels(sourceResult, model);
        if (options.validateBuild) {
            await runProjectValidationStages({
                workspace,
                scenario,
                model,
                executor: new CopilotSdkAgentExecutor(repoRoot),
                projectValidator: new SandboxProjectValidator(repoRoot),
                stages,
                repairBudget,
            });
        }
        await runIntegrationStages({
            workspace,
            scenario,
            model,
            executor: new CopilotSdkAgentExecutor(repoRoot),
            projectValidator: new SandboxProjectValidator(repoRoot),
            stages,
            hasFrontend: scenario.tags.frontend !== 'none',
            repairBudget,
        });
        await runLocalDevelopmentStages({
            workspace,
            scenario,
            model,
            executor: new CopilotSdkAgentExecutor(repoRoot),
            localRuntimeValidator: new SandboxLocalRuntimeValidator(repoRoot),
            stages,
            repairBudget,
        });
    } catch (error) {
        outcome = 'failed';
        errorMessage = error instanceof Error ? error.message : String(error);
        if (error instanceof StageFailure) {
            failedStage = error.stage;
            failureCode = error.code;
            failureCategory = classifyFailure(error.code);
        } else {
            failedStage = 'harness';
            failureCode = 'resumeHarnessError';
            failureCategory = 'harness_failure';
        }
    }

    const completedAt = new Date();
    const resumedDurationMs = completedAt.getTime() - startedAt.getTime();
    const result = {
        schemaVersion: '1',
        evaluationArm: 'rails',
        runId,
        scenarioId: scenario.id,
        attempt: sourceResult.attempt,
        candidateCommit,
        agentAssetsHash,
        evaluationDefinition,
        model,
        requestedModel: model,
        observedModels: observedModels(stages),
        outcome,
        failedStage,
        failureCode,
        failureCategory,
        error: errorMessage,
        durationMs: sourceResult.durationMs + resumedDurationMs,
        agentRetries: repairBudget.usedRetries,
        stages,
        resume: {
            sourceWorkspace,
            sourceResult: sourceResultPath,
            sourceRunId: sourceResult.runId,
            sourceOutcome: sourceResult.outcome,
            sourceFailedStage: sourceResult.failedStage,
            sourceFailureCode: sourceResult.failureCode,
            sourceCandidateCommit: sourceResult.candidateCommit,
            sourceAgentAssetsHash: sourceResult.agentAssetsHash,
            sourceRequestedModel: sourceResult.requestedModel,
            sourceObservedModels: sourceResult.observedModels,
            sourceAgentRetries: sourceResult.agentRetries,
            sourceDurationMs: sourceResult.durationMs,
            resumedDurationMs,
            stage: 'local',
            validateBuild: options.validateBuild,
            regenerateLocal: options.regenerateLocal,
            startedAt: startedAt.toISOString(),
        },
    };
    await fs.writeFile(path.join(resultDirectory, 'run-result.json'), JSON.stringify(result, null, 2) + '\n');
    await fs.writeFile(path.join(path.resolve(options.outputDirectory), 'summary.json'), JSON.stringify({
        schemaVersion: '1',
        evaluationArm: 'rails',
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        candidateCommit,
        agentAssetsHash,
        ...(evaluationDefinition ? { evaluationDefinitions: [evaluationDefinition] } : {}),
        requestedModels: model ? [model] : [],
        observedModels: observedModels(stages),
        through: 'local',
        concurrency: 1,
        attempts: 1,
        successes: outcome === 'autonomous_success' ? 1 : 0,
        failures: outcome === 'failed' ? 1 : 0,
        results: [result],
    }, null, 2) + '\n');
    process.stdout.write(`${outcome === 'autonomous_success' ? 'PASS' : 'FAIL'} ${scenario.id} local resume\n`);
    process.stdout.write(`Results: ${path.resolve(options.outputDirectory)}\n`);
    if (outcome === 'failed') {
        process.exitCode = 1;
    }
}

function assertSourceModels(source: ResumeSourceResult, requestedModel: string): void {
    if (source.requestedModel !== requestedModel) {
        throw new StageFailure(
            'requirements',
            'modelMismatch',
            `Resume requested model "${requestedModel}" but source requested "${source.requestedModel}".`,
        );
    }
    const sourceFailure = validatePinnedModel(requestedModel, source.observedModels);
    if (sourceFailure) {
        throw new StageFailure('requirements', sourceFailure.code, sourceFailure.message);
    }
    for (const stage of source.stages) {
        if (!stage.agentRun) {
            continue;
        }
        const failure = validatePinnedModel(requestedModel, stage.agentRun.usage.models);
        if (failure) {
            throw new StageFailure(stage.name, failure.code, failure.message);
        }
    }
}

function classifyFailure(code: string): EvaluationFailureCategory {
    if (['acceptanceSpecMissing', 'agentCleanupFailed', 'modelMismatch', 'modelNotObserved'].includes(code)) {
        return 'harness_failure';
    }
    if (isSandboxInfrastructureFailureCode(code) || isLocalRuntimeInfrastructureFailureCode(code)) {
        return 'infrastructure_failure';
    }
    return 'product_failure';
}

export function parseResumeArgs(args: string[]): ResumeOptions {
    const options: Partial<ResumeOptions> = {
        regenerateLocal: false,
        validateBuild: false,
    };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        switch (arg) {
            case '--workspace':
                options.workspace = requireValue(args, ++index, arg);
                break;
            case '--scenario':
                options.scenarioId = requireValue(args, ++index, arg);
                break;
            case '--output':
                options.outputDirectory = requireValue(args, ++index, arg);
                break;
            case '--model':
                options.model = requireValue(args, ++index, arg);
                break;
            case '--validate-build':
                options.validateBuild = true;
                break;
            case '--source-result':
                options.sourceResult = requireValue(args, ++index, arg);
                break;
            case '--regenerate-local':
                options.regenerateLocal = true;
                break;
            default:
                throw new Error(`Unknown argument "${arg}".`);
        }
    }
    if (!options.workspace || !options.scenarioId || !options.outputDirectory || !options.model) {
        throw new Error('--workspace, --scenario, --output, and --model are required.');
    }
    if (!options.model.trim()) {
        throw new Error('--model must be a non-empty model id.');
    }
    return options as ResumeOptions;
}

function requireValue(args: string[], index: number, option: string): string {
    const value = args[index];
    if (!value) {
        throw new Error(`${option} requires a value.`);
    }
    return value;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

export function countRepairStages(
    stages: EvaluationStageResult[],
    name: 'repair' | 'local-repair',
): number {
    return stages.filter(stage => stage.name === name).length;
}

export function countConsumedRepairs(stages: EvaluationStageResult[]): number {
    const repairStages = new Set<EvaluationStageResult['name']>([
        'repair',
        'integration-repair',
        'local-repair',
    ]);
    return stages.filter(stage => repairStages.has(stage.name)).length;
}

export async function readSourceResult(
    sourceResultPath: string,
    scenarioId: string,
): Promise<ResumeSourceResult> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(sourceResultPath, 'utf8'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(
                `Resume provenance is required but no run result was found at ${sourceResultPath}. `
                + 'Pass --source-result with the archived run-result.json path.',
                { cause: error },
            );
        }
        throw error;
    }
    if (
        !parsed
        || typeof parsed !== 'object'
        || (parsed as Partial<ResumeSourceResult>).schemaVersion !== '1'
        || (parsed as Partial<ResumeSourceResult>).scenarioId !== scenarioId
        || typeof (parsed as Partial<ResumeSourceResult>).runId !== 'string'
        || typeof (parsed as Partial<ResumeSourceResult>).attempt !== 'number'
        || typeof (parsed as Partial<ResumeSourceResult>).durationMs !== 'number'
        || (parsed as Partial<ResumeSourceResult>).evaluationArm !== 'rails'
        || typeof (parsed as Partial<ResumeSourceResult>).candidateCommit !== 'string'
        || typeof (parsed as Partial<ResumeSourceResult>).agentAssetsHash !== 'string'
        || ((parsed as Partial<ResumeSourceResult>).evaluationDefinition !== undefined
            && !isEvaluationDefinitionProvenance(
                (parsed as Partial<ResumeSourceResult>).evaluationDefinition,
            ))
        || typeof (parsed as Partial<ResumeSourceResult>).requestedModel !== 'string'
        || !Array.isArray((parsed as Partial<ResumeSourceResult>).observedModels)
        || !Number.isInteger((parsed as Partial<ResumeSourceResult>).agentRetries)
        || Number((parsed as Partial<ResumeSourceResult>).agentRetries) < 0
        || !Array.isArray((parsed as Partial<ResumeSourceResult>).stages)
    ) {
        throw new Error(`Invalid or mismatched resume provenance: ${sourceResultPath}`);
    }
    const result = parsed as ResumeSourceResult;
    if (result.agentRetries !== countConsumedRepairs(result.stages)) {
        throw new Error(
            `Invalid resume retry provenance: recorded ${result.agentRetries} retries but found `
            + `${countConsumedRepairs(result.stages)} repair agent stages in ${sourceResultPath}.`,
        );
    }
    return result;
}

if (require.main === module) {
    void main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
