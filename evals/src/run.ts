/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile, execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    CorAgentRunResult,
    CorAgentToolDefinition,
} from '../../src/utils/copilotOnRails/agentExecution/CorAgentExecutor';
import {
    ProjectPlanStatus,
    replaceProjectPlanStatus,
    setProjectPlanExecutionMode,
} from '../../src/webviews/copilotOnRails/views/utils/projectPlanStatus';
import { CopilotSdkAgentExecutor, agentStallMessagePrefix } from './CopilotSdkAgentExecutor';
import { DeploymentSkillProvenance, ensureDeploymentSkill } from './deploymentSkill';
import {
    isLocalRuntimeInfrastructureFailureCode,
    SandboxLocalRuntimeValidationResult,
    SandboxLocalRuntimeValidator,
} from './SandboxLocalRuntimeValidator';
import {
    canContinueAfterProjectValidationFailure,
    isSandboxInfrastructureFailureCode,
    SandboxProjectValidationResult,
    SandboxProjectValidator,
} from './SandboxProjectValidator';
import {
    computeAgentAssetsHash,
    prepareAgentWorkspace,
} from './agentAssets';
import {
    EvaluationDefinitionProvenance,
    computeEvaluationDefinition,
} from './evaluationDefinition';
import {
    confirmRequirementsArtifact,
    validateRequirementsArtifact,
} from './artifacts/requirements';
import { validateIntegrationPlanArtifact } from './artifacts/integrationPlan';
import { validateIntegrationOutput } from './artifacts/integrationOutput';
import {
    applyLocalRuntimeEvidence,
    diagnoseGeneratedCode,
    validateLocalDebugArtifacts,
    validateLocalDebugPlanArtifact,
} from './artifacts/localDebug';
import { PlanGateState, validatePlanEvaluationContract } from './artifacts/planEvaluation';
import { validatePreviewArtifacts } from './artifacts/preview';
import { validateProjectPlanArtifact } from './artifacts/projectPlan';
import { ArtifactValidationResult } from './artifacts/validationTypes';
import {
    AgentRepairBudget,
    createAgentRepairBudget,
    createStageRepairBudgets,
    totalUsedAgentRepairs,
    tryConsumeAgentRepair,
    validatePinnedModel,
} from './evaluationParity';
import { CorEvaluationScenario, loadScenarios } from './scenario';
import {
    evaluateDeploymentReadiness,
    type DeploymentReadinessCommandRunner,
    type DeploymentReadinessResult,
} from './deploymentReadiness';

interface RunOptions {
    attempts: number;
    concurrency: number;
    dryRun: boolean;
    through: 'plan' | 'scaffold' | 'local' | 'deploy';
    model?: string;
    scenarioId?: string;
    outputDirectory?: string;
}

export interface EvaluationStageResult {
    name: 'requirements' | 'plan' | 'scaffold' | 'repair' | 'build' | 'integration' | 'integration-repair' | 'integration-build' | 'debug-plan' | 'debug-generate' | 'local-repair' | 'local-artifacts' | 'local-runtime' | 'deploy-plan' | 'deploy-skill' | 'deploy-generate' | 'deploy-readiness';
    agentRun?: CorAgentRunResult;
    validation?: ArtifactValidationResult;
    buildValidation?: SandboxProjectValidationResult;
    localRuntimeValidation?: SandboxLocalRuntimeValidationResult;
    deploymentReadiness?: DeploymentReadinessResult;
    deploymentSkill?: DeploymentSkillProvenance;
    gateCalled?: boolean;
}

export interface EvaluationAttemptResult {
    schemaVersion: '1';
    evaluationArm: 'rails';
    runId: string;
    scenarioId: string;
    attempt: number;
    candidateCommit: string;
    agentAssetsHash: string;
    evaluationDefinition?: EvaluationDefinitionProvenance;
    model?: string;
    requestedModel?: string;
    observedModels: string[];
    outcome: 'autonomous_success' | 'failed';
    failedStage?: EvaluationStageResult['name'] | 'harness';
    failureCode?: string;
    failureCategory?: EvaluationFailureCategory;
    error?: string;
    qualityFailures?: EvaluationQualityFailure[];
    durationMs: number;
    agentRetries: number;
    stages: EvaluationStageResult[];
}

export type EvaluationFailureCategory = 'product_failure' | 'harness_failure' | 'infrastructure_failure';

export interface EvaluationQualityFailure {
    stage: EvaluationStageResult['name'];
    code: string;
    category: 'product_failure';
    error: string;
}

const emptyObjectSchema: Record<string, unknown> = {
    type: 'object',
    properties: {},
    additionalProperties: false,
};

async function main(): Promise<void> {
    const repoRoot = process.cwd();
    const options = parseRunArgs(process.argv.slice(2));
    const scenarios = (await loadScenarios(path.join(repoRoot, 'evals', 'scenarios')))
        .filter(scenario => !options.scenarioId || scenario.id === options.scenarioId);
    if (!scenarios.length) {
        throw new Error(options.scenarioId
            ? `Unknown scenario "${options.scenarioId}".`
            : 'No evaluation scenarios found.');
    }
    if (options.dryRun) {
        await runDryValidation(repoRoot, scenarios);
        return;
    }

    const model = options.model as string;
    const started = new Date();
    const outputDirectory = path.resolve(options.outputDirectory
        ?? path.join(repoRoot, 'evals', 'results', started.toISOString().replace(/[:.]/g, '-')));
    await fs.mkdir(outputDirectory, { recursive: true });
    const candidateCommit = getCandidateCommit(repoRoot);
    const agentAssetsHash = await computeAgentAssetsHash(repoRoot);
    const evaluationDefinition = await computeEvaluationDefinition(
        repoRoot,
        scenarios.map(scenario => scenario.id),
    );
    const executor = new CopilotSdkAgentExecutor(repoRoot);
    const projectValidator = new SandboxProjectValidator(repoRoot);
    const localRuntimeValidator = new SandboxLocalRuntimeValidator(repoRoot);
    const results: EvaluationAttemptResult[] = [];

    const jobs = scenarios.flatMap(scenario =>
        Array.from({ length: options.attempts }, (_, index) => ({ scenario, attempt: index + 1 })));
    await runWithConcurrency(jobs, options.concurrency, async ({ scenario, attempt }) => {
            let result: EvaluationAttemptResult;
            try {
                result = await runAttempt({
                    repoRoot,
                    outputDirectory,
                    scenario,
                    attempt,
                    candidateCommit,
                    agentAssetsHash,
                    evaluationDefinition,
                    model,
                    executor,
                    projectValidator,
                    localRuntimeValidator,
                    through: options.through,
                });
            } catch (error) {
                result = createHarnessFailureResult({
                    scenario,
                    attempt,
                    candidateCommit,
                    agentAssetsHash,
                    evaluationDefinition,
                    model,
                    error,
                });
            }
            results.push(result);
            process.stdout.write(`${result.outcome === 'autonomous_success' ? 'PASS' : 'FAIL'} ${scenario.id} attempt ${attempt}\n`);
    });

    const summary = {
        schemaVersion: '1',
        evaluationArm: 'rails',
        startedAt: started.toISOString(),
        completedAt: new Date().toISOString(),
        candidateCommit,
        agentAssetsHash,
        evaluationDefinitions: [evaluationDefinition],
        requestedModels: unique(results.flatMap(result =>
            result.requestedModel ? [result.requestedModel] : [])),
        observedModels: unique(results.flatMap(result => result.observedModels)),
        through: options.through,
        concurrency: options.concurrency,
        attempts: results.length,
        successes: results.filter(result => result.outcome === 'autonomous_success').length,
        failures: results.filter(result => result.outcome === 'failed').length,
        results,
    };
    await fs.writeFile(path.join(outputDirectory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    process.stdout.write(`Results: ${outputDirectory}\n`);
    if (summary.failures > 0) {
        process.exitCode = 1;
    }
}

async function runAttempt(input: {
    repoRoot: string;
    outputDirectory: string;
    scenario: CorEvaluationScenario;
    attempt: number;
    candidateCommit: string;
    agentAssetsHash: string;
    evaluationDefinition: EvaluationDefinitionProvenance;
    model?: string;
    executor: CopilotSdkAgentExecutor;
    projectValidator: SandboxProjectValidator;
    localRuntimeValidator: SandboxLocalRuntimeValidator;
    through: RunOptions['through'];
    deploymentCommandRunner?: DeploymentReadinessCommandRunner;
}): Promise<EvaluationAttemptResult> {
    const started = Date.now();
    const runId = `${input.scenario.id}-${input.attempt}-${started}`;
    const resultDirectory = path.join(input.outputDirectory, runId);
    const workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cor-eval-')));
    const stages: EvaluationStageResult[] = [];
    const repairBudgets = createStageRepairBudgets(input.scenario.validation.maxAgentRetries);
    const deferredFailures: StageFailure[] = [];
    let result: EvaluationAttemptResult;
    await fs.mkdir(resultDirectory, { recursive: true });

    try {
        await prepareAgentWorkspace(input.repoRoot, workspace);
        const requirementsGate = { called: false };
        const planGate: PlanGateState = { called: false };
        const tools = createGateTools(requirementsGate, planGate, workspace);
        const requirementsRun = await input.executor.run({
            agentName: 'azure-project-plan',
            prompt: input.scenario.prompt,
            workingDirectory: workspace,
            model: input.model,
            tools,
            completionToolNames: ['open_requirements_view'],
        });
        const requirementsStage: EvaluationStageResult = {
            name: 'requirements',
            agentRun: requirementsRun,
            gateCalled: requirementsGate.called,
        };
        stages.push(requirementsStage);
        assertAgentRunCompleted('requirements', requirementsRun, input.model);
        const requirementsPath = path.join(workspace, '.azure', 'requirements.json');
        const requirementsContent = await readRequiredArtifact('requirements', requirementsPath);
        const requirementsValidation = validateRequirementsArtifact(requirementsContent);
        requirementsStage.validation = requirementsValidation;
        assertArtifactStageSucceeded('requirements', requirementsValidation, requirementsGate.called);

        const confirmedRequirements = confirmRequirementsArtifact(
            requirementsContent,
            input.scenario.requirementsAnswers,
        );
        await fs.writeFile(requirementsPath, confirmedRequirements);

        planGate.called = false;
        const planRun = await input.executor.run({
            agentName: 'azure-project-plan',
            prompt: 'Requirements submitted at .azure/requirements.json — read the file and continue generating .azure/project-plan.md.',
            workingDirectory: workspace,
            model: input.model,
            timeoutMs: input.scenario.validation.timeoutMinutes * 60 * 1000,
            builtInTools: workspaceFileTools,
            additionalSystemMessage: [
                'The open_plan_view tool records that the view opened; it does not end a UI planning run.',
                'For plans with a frontend, continue after that tool call until every .azure/.preview-temp HTML file is complete and manifest.json has previewStatus ready.',
                'Generate all files directly without delegating to sub-agents.',
                'After all plan and preview artifacts are complete, call complete_plan_evaluation and stop.',
            ].join(' '),
            tools,
            completionToolNames: ['complete_plan_evaluation'],
        });
        const planStage: EvaluationStageResult = {
            name: 'plan',
            agentRun: planRun,
            gateCalled: planGate.called,
        };
        stages.push(planStage);
        assertAgentRunCompleted('plan', planRun, input.model);
        const planContent = await readRequiredArtifact('plan', path.join(workspace, '.azure', 'project-plan.md'));
        let planValidation = validateProjectPlanArtifact(planContent, { expectedStatus: 'Planning' });
        const expectedFrontend = scenarioHasFrontend(input.scenario);
        const generatedFrontend = planHasFrontend(planContent);
        planValidation = combineValidationResults(
            planValidation,
            validatePlanEvaluationContract(expectedFrontend, generatedFrontend, planGate),
        );
        if (expectedFrontend) {
            const previewValidation = await validatePreviewArtifacts(
                path.join(workspace, '.azure', '.preview-temp'),
            );
            planValidation = combineValidationResults(planValidation, previewValidation);
        }
        planStage.validation = planValidation;
        assertArtifactStageSucceeded('plan', planValidation, planGate.called);

        if (isThrough(input.through, 'scaffold')) {
            const approvedPlan = replaceProjectPlanStatus(planContent, ProjectPlanStatus.approved);
            if (!approvedPlan) {
                throw new StageFailure('scaffold', 'planApprovalFailed', 'Could not update the project plan status to Approved.');
            }
            await fs.writeFile(
                path.join(workspace, '.azure', 'project-plan.md'),
                setProjectPlanExecutionMode(approvedPlan, 'auto'),
            );

            const scaffoldGate = { called: false };
            const scaffoldRun = await input.executor.run({
                agentName: 'azure-project-scaffold',
                prompt: '[AUTOPILOT MODE] I approve the plan. Scaffold the complete project and write `.azure/integration-plan.md`.',
                workingDirectory: workspace,
                model: input.model,
                timeoutMs: input.scenario.validation.timeoutMinutes * 60 * 1000,
                builtInTools: workspaceFileTools,
                additionalSystemMessage: [
                    'The evaluator, not this agent, owns dependency restore, build, lint, and test command execution.',
                    'Do not run shell commands. Generate complete source, configuration, tests, and package manifests using workspace file tools.',
                    'Generate all files directly without delegating to sub-agents.',
                    'After all files and `.azure/integration-plan.md` are written, call `start_project_integrate` and stop.',
                ].join(' '),
                tools: createScaffoldTools(scaffoldGate),
                completionToolNames: ['start_project_integrate'],
            });
            const scaffoldStage: EvaluationStageResult = {
                name: 'scaffold',
                agentRun: scaffoldRun,
                gateCalled: scaffoldGate.called,
            };
            stages.push(scaffoldStage);
            assertAgentRunCompleted('scaffold', scaffoldRun, input.model);
            const integrationPlanContent = await readRequiredArtifact(
                'scaffold',
                path.join(workspace, '.azure', 'integration-plan.md'),
            );
            const integrationPlanValidation = validateIntegrationPlanArtifact(integrationPlanContent, {
                hasFrontend: expectedFrontend,
            });
            scaffoldStage.validation = integrationPlanValidation;
            assertArtifactStageSucceeded('scaffold', integrationPlanValidation, scaffoldGate.called);

            const scaffoldValidationFailure = await runProjectValidationStages({
                workspace,
                scenario: input.scenario,
                model: input.model,
                executor: input.executor,
                projectValidator: input.projectValidator,
                stages,
                repairBudget: repairBudgets.build,
                continueAfterQualityFailure: input.through === 'local',
            });
            if (scaffoldValidationFailure) {
                deferredFailures.push(scaffoldValidationFailure);
            }

            if (isThrough(input.through, 'local')) {
                const integrationValidationFailure = await runIntegrationStages({
                    workspace,
                    scenario: input.scenario,
                    model: input.model,
                    executor: input.executor,
                    projectValidator: input.projectValidator,
                    stages,
                    hasFrontend: expectedFrontend,
                    repairBudget: repairBudgets.integration,
                    continueAfterQualityFailure: true,
                });
                if (integrationValidationFailure) {
                    deferredFailures.push(integrationValidationFailure);
                }
                await runLocalDevelopmentStages({
                    workspace,
                    scenario: input.scenario,
                    model: input.model,
                    executor: input.executor,
                    localRuntimeValidator: input.localRuntimeValidator,
                    stages,
                    repairBudget: repairBudgets.local,
                });
                if (isThrough(input.through, 'deploy')) {
                    await runDeploymentStages({
                        workspace,
                        scenario: input.scenario,
                        model: input.model,
                        executor: input.executor,
                        stages,
                        deploymentCommandRunner: input.deploymentCommandRunner,
                    });
                }
            }
        }

        const primaryFailure = deferredFailures[0];
        const classifiedFailure = primaryFailure ? classifyFailure(primaryFailure) : undefined;
        result = {
            schemaVersion: '1',
            evaluationArm: 'rails',
            runId,
            scenarioId: input.scenario.id,
            attempt: input.attempt,
            candidateCommit: input.candidateCommit,
            agentAssetsHash: input.agentAssetsHash,
            evaluationDefinition: input.evaluationDefinition,
            model: input.model,
            requestedModel: input.model,
            observedModels: observedModels(stages),
            outcome: primaryFailure ? 'failed' : 'autonomous_success',
            failedStage: classifiedFailure?.stage,
            failureCode: classifiedFailure?.code,
            failureCategory: classifiedFailure?.category,
            error: primaryFailure?.message,
            ...(deferredFailures.length ? {
                qualityFailures: deferredFailures.map(toQualityFailure),
            } : {}),
            durationMs: Date.now() - started,
            agentRetries: totalUsedAgentRepairs(repairBudgets),
            stages,
        };
    } catch (error) {
        const terminalFailure = classifyFailure(error);
        result = {
            schemaVersion: '1',
            evaluationArm: 'rails',
            runId,
            scenarioId: input.scenario.id,
            attempt: input.attempt,
            candidateCommit: input.candidateCommit,
            agentAssetsHash: input.agentAssetsHash,
            evaluationDefinition: input.evaluationDefinition,
            model: input.model,
            requestedModel: input.model,
            observedModels: observedModels(stages),
            outcome: 'failed',
            failedStage: terminalFailure.stage,
            failureCode: terminalFailure.code,
            failureCategory: terminalFailure.category,
            error: [
                getErrorMessage(error),
                deferredFailures.length
                    ? `Earlier quality failures: ${deferredFailures.map(value => value.message).join(' | ')}`
                    : undefined,
            ].filter(Boolean).join(' '),
            ...(deferredFailures.length ? {
                qualityFailures: deferredFailures.map(toQualityFailure),
            } : {}),
            durationMs: Date.now() - started,
            agentRetries: totalUsedAgentRepairs(repairBudgets),
            stages,
        };
    }

    const finalizationErrors: string[] = [];
    try {
        await archiveIfPresent(path.join(workspace, '.azure'), path.join(resultDirectory, '.azure'));
        await archiveIfPresent(workspace, path.join(resultDirectory, 'workspace'));
    } catch (error) {
        finalizationErrors.push(`Artifact archival failed: ${getErrorMessage(error)}`);
    }
    try {
        await fs.rm(workspace, { recursive: true, force: true });
    } catch (error) {
        finalizationErrors.push(`Workspace cleanup failed: ${getErrorMessage(error)}`);
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

function createGateTools(
    requirementsGate: { called: boolean },
    planGate: PlanGateState,
    workspace: string,
): CorAgentToolDefinition[] {
    return [
        {
            name: 'open_requirements_view',
            description: 'Record that the requirements artifact is ready for review, then stop and wait.',
            parameters: emptyObjectSchema,
            handler: () => {
                requirementsGate.called = true;
                return { message: 'Requirements artifact recorded. Stop and wait for the automated evaluator.' };
            },
        },
        {
            name: 'open_plan_view',
            description: 'Record that the project plan view opened. Continue generating all frontend preview files before stopping.',
            parameters: emptyObjectSchema,
            handler: async () => {
                if (!planGate.called) {
                    await capturePlanGateState(workspace, planGate);
                }
                return {
                    message: 'Project plan view recorded. For a UI plan, continue until every preview page is written and previewStatus is ready. For a non-UI plan, stop.',
                };
            },
        },
        {
            name: 'complete_plan_evaluation',
            description: 'Signal that the project plan and all required frontend preview artifacts are complete, then stop.',
            parameters: emptyObjectSchema,
            handler: () => ({
                message: 'Plan and preview completion recorded. Stop and wait for the automated evaluator.',
            }),
        },
    ];
}

async function capturePlanGateState(workspace: string, planGate: PlanGateState): Promise<void> {
    planGate.called = true;
    const previewDirectory = path.join(workspace, '.azure', '.preview-temp');
    try {
        const entries = await fs.readdir(previewDirectory, { withFileTypes: true });
        planGate.previewManifestPresentAtCall = entries.some(entry => entry.isFile() && entry.name === 'manifest.json');
        planGate.previewHtmlFilesAtCall = entries
            .filter(entry => entry.isFile() && entry.name.endsWith('.html'))
            .map(entry => entry.name)
            .sort();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
        planGate.previewManifestPresentAtCall = false;
        planGate.previewHtmlFilesAtCall = [];
    }
}

function createScaffoldTools(scaffoldGate: { called: boolean }): CorAgentToolDefinition[] {
    return [
        {
            name: 'start_project_integrate',
            description: 'Record that scaffolding and the integration hand-off artifact are complete, then stop.',
            parameters: {
                type: 'object',
                properties: {
                    prompt: { type: 'string' },
                },
                additionalProperties: false,
            },
            handler: () => {
                scaffoldGate.called = true;
                return { message: 'Scaffold hand-off recorded. Stop and wait for the automated evaluator.' };
            },
        },
        {
            name: 'open_frontend_preview_view',
            description: 'Record a frontend preview request. Autopilot evaluations should use start_project_integrate instead.',
            parameters: {
                type: 'object',
                properties: {
                    frontendFolder: { type: 'string' },
                },
                additionalProperties: false,
            },
            handler: () => ({ message: 'Autopilot is active. Complete the scaffold and call start_project_integrate.' }),
        },
    ];
}

function createIntegrationTools(integrationGate: { called: boolean }): CorAgentToolDefinition[] {
    return [{
        name: 'start_local_development',
        description: 'Record that integration is complete and the project is ready for local-development setup, then stop.',
        parameters: {
            type: 'object',
            properties: {
                prompt: { type: 'string' },
            },
            additionalProperties: false,
        },
        handler: () => {
            integrationGate.called = true;
            return { message: 'Integration hand-off recorded. Stop and wait for the automated evaluator.' };
        },
    }];
}

export async function runIntegrationStages(input: {
    workspace: string;
    scenario: CorEvaluationScenario;
    model?: string;
    executor: CopilotSdkAgentExecutor;
    projectValidator: SandboxProjectValidator;
    stages: EvaluationStageResult[];
    hasFrontend: boolean;
    repairBudget?: AgentRepairBudget;
    continueAfterQualityFailure?: boolean;
}): Promise<StageFailure | undefined> {
    const repairBudget = input.repairBudget
        ?? createAgentRepairBudget(input.scenario.validation.maxAgentRetries);
    const planPath = path.join(input.workspace, '.azure', 'project-plan.md');
    const planContent = await readRequiredArtifact('integration', planPath);
    const integratingPlan = replaceProjectPlanStatus(planContent, ProjectPlanStatus.integrating);
    if (!integratingPlan) {
        throw new StageFailure('integration', 'integrationApprovalFailed', 'Could not update the project plan status to Integrating.');
    }
    await fs.writeFile(planPath, integratingPlan);

    const integrationGate = { called: false };
    const integrationRun = await input.executor.run({
        agentName: 'azure-project-integrate',
        prompt: '[AUTOPILOT MODE] The scaffold and frontend preview are approved. Complete migrations, replace frontend mock data with the live backend, and finish end-to-end integration.',
        workingDirectory: input.workspace,
        model: input.model,
        timeoutMs: input.scenario.validation.timeoutMinutes * 60 * 1000,
        builtInTools: workspaceFileTools,
        additionalSystemMessage: [
            'The evaluator, not this agent, owns dependency restore, command execution, backend smoke tests, and end-to-end runtime validation in an isolated ACA Sandbox.',
            'Do not run shell commands or network requests and do not fabricate command results.',
            'When mock authentication is used, a migration or seed source must provision the exact default mock-user UUID sent by the integrated frontend, including every required user field.',
            'Complete every required integration file change using workspace file tools, update the project plan to Integrated, call start_local_development, and stop.',
        ].join(' '),
        tools: createIntegrationTools(integrationGate),
        completionToolNames: ['start_local_development'],
    });
    const integrationStage: EvaluationStageResult = {
        name: 'integration',
        agentRun: integrationRun,
        gateCalled: integrationGate.called,
    };
    input.stages.push(integrationStage);
    assertAgentRunCompleted('integration', integrationRun, input.model);

    const integratedPlan = await readRequiredArtifact('integration', planPath);
    let integrationValidation = combineValidationResults(
        validateProjectPlanArtifact(integratedPlan, { expectedStatus: ProjectPlanStatus.integrated }),
        await validateIntegrationOutput(input.workspace, { hasFrontend: input.hasFrontend }),
    );
    integrationStage.validation = integrationValidation;
    while (!integrationValidation.valid) {
        const repairAttempt = tryConsumeAgentRepair(repairBudget);
        if (repairAttempt === undefined) {
            break;
        }
        const repairRun = await input.executor.run({
            agentName: 'azure-project-integrate',
            prompt: [
                `[AUTOPILOT INTEGRATION REPAIR MODE] Repair attempt ${repairAttempt}.`,
                'Fix only the integration contract failures below using workspace file tools, then stop. Do not run commands or call hand-off tools.',
                '```json',
                JSON.stringify(integrationValidation.issues, null, 2),
                '```',
            ].join('\n'),
            workingDirectory: input.workspace,
            model: input.model,
            timeoutMs: input.scenario.validation.timeoutMinutes * 60 * 1000,
            builtInTools: workspaceFileTools,
            additionalSystemMessage: [
                'Preserve the Integrated project-plan status and existing live frontend API wiring.',
                'When repairing mock authentication, provision the exact frontend default mock-user UUID in an executable migration or seed source with all required user fields.',
                'Do not run shell commands or network requests.',
            ].join(' '),
        });
        input.stages.push({ name: 'integration-repair', agentRun: repairRun });
        assertAgentRunCompleted('integration-repair', repairRun, input.model);
        integrationValidation = combineValidationResults(
            validateProjectPlanArtifact(
                await readRequiredArtifact('integration', planPath),
                { expectedStatus: ProjectPlanStatus.integrated },
            ),
            await validateIntegrationOutput(input.workspace, { hasFrontend: input.hasFrontend }),
        );
        input.stages.push({
            name: 'integration',
            validation: integrationValidation,
            gateCalled: integrationGate.called,
        });
    }
    assertArtifactStageSucceeded('integration', integrationValidation, integrationGate.called);

    return runProjectValidationStages({
        workspace: input.workspace,
        scenario: input.scenario,
        model: input.model,
        executor: input.executor,
        projectValidator: input.projectValidator,
        stages: input.stages,
        repairBudget,
        continueAfterQualityFailure: input.continueAfterQualityFailure,
        validationStageName: 'integration-build',
        repairStageName: 'integration-repair',
        repairAgentName: 'azure-project-integrate',
        repairSystemMessage: [
            'This is an evaluator-directed integration repair pass.',
            'Fix only the reported post-integration build, test, or lint failure using workspace file tools.',
            'Preserve the live API wiring, migrations, and Integrated plan status.',
            'Do not run shell commands or call hand-off tools; the evaluator will revalidate in an isolated sandbox.',
        ].join(' '),
    });
}

export async function runProjectValidationStages(input: {
    workspace: string;
    scenario: CorEvaluationScenario;
    model?: string;
    executor: CopilotSdkAgentExecutor;
    projectValidator: SandboxProjectValidator;
    stages: EvaluationStageResult[];
    repairBudget?: AgentRepairBudget;
    validationStageName?: 'build' | 'integration-build';
    repairStageName?: 'repair' | 'integration-repair';
    repairAgentName?: 'azure-project-scaffold' | 'azure-project-integrate';
    repairSystemMessage?: string;
    continueAfterQualityFailure?: boolean;
}): Promise<StageFailure | undefined> {
    const validationStageName = input.validationStageName ?? 'build';
    const repairStageName = input.repairStageName ?? 'repair';
    const repairBudget = input.repairBudget
        ?? createAgentRepairBudget(input.scenario.validation.maxAgentRetries);
    let buildValidation = await input.projectValidator.validate(input.workspace, input.scenario);
    input.stages.push({ name: validationStageName, buildValidation });
    while (shouldRepair(buildValidation, repairBudget)) {
        const repairAttempt = tryConsumeAgentRepair(repairBudget) as number;
        const repairRun = await input.executor.run({
            agentName: input.repairAgentName ?? 'azure-project-scaffold',
            prompt: await createRepairPrompt(buildValidation, repairAttempt, input.workspace),
            workingDirectory: input.workspace,
            model: input.model,
            timeoutMs: input.scenario.validation.timeoutMinutes * 60 * 1000,
            builtInTools: workspaceFileTools,
            additionalSystemMessage: input.repairSystemMessage ?? [
                'This is an evaluator-directed repair pass that overrides the normal scaffold phase entry and hand-off rules.',
                'The existing scaffold and plan status are valid inputs. Do not regenerate unaffected files or require an Approved status.',
                'Before editing, read the scaffold testing reference and the generated project runtime reference relevant to the failed command.',
                'Fix only the reported validation failure using workspace file tools. Do not run shell commands or call hand-off tools.',
                'Stop after the fixes are written; the evaluator will execute validation in an isolated sandbox.',
            ].join(' '),
        });
        input.stages.push({ name: repairStageName, agentRun: repairRun });
        assertAgentRunCompleted(repairStageName, repairRun, input.model);
        buildValidation = await input.projectValidator.validate(input.workspace, input.scenario);
        input.stages.push({ name: validationStageName, buildValidation });
    }
    if (buildValidation.outcome !== 'passed') {
        const failure = new StageFailure(
            validationStageName,
            buildValidation.failureCode ?? 'buildValidationFailed',
            buildValidation.error ?? 'Generated project validation failed.',
        );
        if (
            input.continueAfterQualityFailure
            && canContinueAfterProjectValidationFailure(buildValidation)
        ) {
            return failure;
        }
        throw failure;
    }
    return undefined;
}

export async function runLocalDevelopmentStages(input: {
    workspace: string;
    scenario: CorEvaluationScenario;
    model?: string;
    executor: CopilotSdkAgentExecutor;
    localRuntimeValidator: SandboxLocalRuntimeValidator;
    stages: EvaluationStageResult[];
    repairBudget?: AgentRepairBudget;
}): Promise<number> {
    const repairBudget = input.repairBudget
        ?? createAgentRepairBudget(input.scenario.validation.maxAgentRetries);
    const debugPlanGate = { called: false };
    const debugPlanRun = await input.executor.run({
        agentName: 'azure-debug-plan',
        prompt: '[AUTOPILOT MODE] The scaffolded project builds successfully. Generate and approve `.azure/vscode-debug-plan.md`, then hand off to local debug artifact generation.',
        workingDirectory: input.workspace,
        model: input.model,
        timeoutMs: input.scenario.validation.timeoutMinutes * 60 * 1000,
        builtInTools: workspaceFileTools,
        additionalSystemMessage: [
            'This evaluation runs without access to host commands or VS Code UI.',
            'Inspect project files using workspace file tools. Mark prerequisites that require command execution as unconfirmed rather than stopping.',
            'Do not run shell commands or network requests.',
            'Autopilot is active: write a complete plan with Execution Mode Auto and Status Approved, call start_azure_debug_generate, and stop.',
        ].join(' '),
        tools: createDebugPlanTools(debugPlanGate),
        completionToolNames: ['start_azure_debug_generate'],
    });
    const debugPlanStage: EvaluationStageResult = {
        name: 'debug-plan',
        agentRun: debugPlanRun,
        gateCalled: debugPlanGate.called,
    };
    input.stages.push(debugPlanStage);
    assertAgentRunCompleted('debug-plan', debugPlanRun, input.model);
    const debugPlanPath = path.join(input.workspace, '.azure', 'vscode-debug-plan.md');
    const debugPlanContent = await readRequiredArtifact('debug-plan', debugPlanPath);
    const debugPlanValidation = validateLocalDebugPlanArtifact(debugPlanContent, {
        expectedStatus: 'Approved',
        requireAutoMode: true,
        requireSuccessfulChecklist: false,
    });
    debugPlanStage.validation = debugPlanValidation;
    assertArtifactStageSucceeded('debug-plan', debugPlanValidation, debugPlanGate.called);

    const debugGenerateGate = { called: false };
    const debugGenerateRun = await input.executor.run({
        agentName: 'azure-debug-generate',
        prompt: '[AUTOPILOT MODE] The local debugging plan has been approved. Generate every artifact specified by `.azure/vscode-debug-plan.md`.',
        workingDirectory: input.workspace,
        model: input.model,
        timeoutMs: input.scenario.validation.timeoutMinutes * 60 * 1000,
        builtInTools: workspaceFileTools,
        additionalSystemMessage: [
            'The evaluator, not this agent, owns all command execution and live validation in an isolated ACA Sandbox.',
            'Do not run shell commands, start processes, access the network, or fabricate validation evidence.',
            'Generate the complete VS Code, emulator, settings, convenience-script, and API-test artifacts selected by the approved plan.',
            'Leave the plan Status as Executing because live validation has not run.',
            'After all files are written, call open_local_next_steps_view with the correct hasApiTests value and stop.',
        ].join(' '),
        tools: createDebugGenerateTools(debugGenerateGate),
        completionToolNames: ['open_local_next_steps_view'],
    });
    const debugGenerateStage: EvaluationStageResult = {
        name: 'debug-generate',
        agentRun: debugGenerateRun,
        gateCalled: debugGenerateGate.called,
    };
    input.stages.push(debugGenerateStage);
    assertAgentRunCompleted('debug-generate', debugGenerateRun, input.model);
    let generatedDebugPlan = await readRequiredArtifact('debug-generate', debugPlanPath);
    let localArtifactsValidation = await validateLocalDebugArtifacts(
        input.workspace,
        generatedDebugPlan,
        { requireSuccessfulChecklist: false },
    );
    input.stages.push({
        name: 'local-artifacts',
        validation: localArtifactsValidation,
        gateCalled: debugGenerateGate.called,
    });

    let localRuntimeValidation: SandboxLocalRuntimeValidationResult | undefined;
    while (true) {
        if (!localArtifactsValidation.valid) {
            const repairAttempt = tryConsumeAgentRepair(repairBudget);
            if (repairAttempt === undefined) {
                if (!debugGenerateGate.called) {
                    throw new StageFailure(
                        'local-artifacts',
                        'gateNotCalled',
                        'Agent did not call the local-artifacts review gate.',
                    );
                }
                throw new StageFailure(
                    'local-artifacts',
                    'artifactInvalid',
                    localArtifactsValidation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '),
                );
            }
            await runLocalRepair(input, createLocalArtifactRepairPrompt(localArtifactsValidation, repairAttempt));
        } else {
            localRuntimeValidation = await input.localRuntimeValidator.validate(
                input.workspace,
                input.scenario,
                generatedDebugPlan,
            );
            input.stages.push({
                name: 'local-runtime',
                localRuntimeValidation,
            });
            if (localRuntimeValidation.outcome === 'passed') {
                break;
            }
            if (
                isLocalRuntimeInfrastructureFailureCode(localRuntimeValidation.failureCode)
            ) {
                throw new StageFailure(
                    'local-runtime',
                    localRuntimeValidation.failureCode ?? 'localRuntimeValidationFailed',
                    localRuntimeValidation.error ?? 'Generated local-debug setup failed isolated runtime validation.',
                );
            }
            const repairAttempt = tryConsumeAgentRepair(repairBudget);
            if (repairAttempt === undefined) {
                throw new StageFailure(
                    'local-runtime',
                    localRuntimeValidation.failureCode ?? 'localRuntimeValidationFailed',
                    localRuntimeValidation.error ?? 'Generated local-debug setup failed isolated runtime validation.',
                );
            }
            await runLocalRepair(input, createLocalRuntimeRepairPrompt(localRuntimeValidation, repairAttempt));
        }

        generatedDebugPlan = await readRequiredArtifact('local-repair', debugPlanPath);
        localArtifactsValidation = await validateLocalDebugArtifacts(
            input.workspace,
            generatedDebugPlan,
            { requireSuccessfulChecklist: false },
        );
        input.stages.push({
            name: 'local-artifacts',
            validation: localArtifactsValidation,
            gateCalled: true,
        });
    }

    if (!localRuntimeValidation) {
        throw new StageFailure('local-runtime', 'localRuntimeValidationMissing', 'Local runtime validation did not run.');
    }
    const implementedDebugPlan = applyLocalRuntimeEvidence(generatedDebugPlan, localRuntimeValidation);
    await fs.writeFile(debugPlanPath, implementedDebugPlan);
    const implementedValidation = validateLocalDebugPlanArtifact(implementedDebugPlan, {
        expectedStatus: 'Implemented',
        requireAutoMode: true,
        requireSuccessfulChecklist: true,
    });
    const localRuntimeStage = [...input.stages].reverse().find(stage =>
        stage.name === 'local-runtime' && stage.localRuntimeValidation === localRuntimeValidation);
    if (localRuntimeStage) {
        localRuntimeStage.validation = implementedValidation;
    }
    if (!implementedValidation.valid) {
        throw new StageFailure(
            'local-runtime',
            'localEvidenceInvalid',
            implementedValidation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '),
        );
    }
    return repairBudget.usedRetries;
}

async function runLocalRepair(
    input: {
        workspace: string;
        scenario: CorEvaluationScenario;
        model?: string;
        executor: CopilotSdkAgentExecutor;
        stages: EvaluationStageResult[];
    },
    prompt: string,
): Promise<void> {
    const repairRun = await input.executor.run({
        agentName: 'azure-debug-generate',
        prompt,
        workingDirectory: input.workspace,
        model: input.model,
        timeoutMs: input.scenario.validation.timeoutMinutes * 60 * 1000,
        builtInTools: workspaceFileTools,
        additionalSystemMessage: [
            'This is an evaluator-directed repair pass that overrides normal phase entry, validation, and hand-off rules.',
            'The existing approved plan and generated local-debug artifacts are valid repair inputs.',
            'Read the matching runtime, project-type, and emulator references before editing.',
            'Fix only the reported failure using workspace file tools. Do not run commands, call hand-off tools, or fabricate validation evidence.',
            'Keep the plan Status as Executing and stop after writing the fixes; the evaluator will rerun validation in an isolated sandbox.',
        ].join(' '),
    });
    input.stages.push({ name: 'local-repair', agentRun: repairRun });
    assertAgentRunCompleted('local-repair', repairRun, input.model);
}

const workspaceFileTools = [
    'apply_patch',
    'create',
    'edit',
    'glob',
    'grep',
    'rg',
    'view',
];

/**
 * `azd` runs on the evaluator host rather than inside the agent session, so the packaging evidence
 * is produced by the harness and cannot be self-reported by the agent under test.
 */
export function createLocalDeploymentCommandRunner(workspace: string): DeploymentReadinessCommandRunner {
    return {
        run: (_name, command, timeoutMs) => new Promise(resolve => {
            execFile(
                '/bin/sh',
                ['-c', command],
                { cwd: workspace, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
                (error, stdout, stderr) => resolve({
                    success: !error,
                    failureKind: error ? ((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'runnerError' : 'commandExit') : undefined,
                    stdout: String(stdout),
                    stderr: String(stderr),
                }),
            );
        }),
    };
}

/**
 * The deployment phase the product actually ships: `azure-deploy` generates infra, `azure.yaml` and
 * Dockerfiles, and the promise it makes is that `azd package` accepts them. The agent has no shell
 * in an evaluation, so the evaluator - not the agent - runs `azd`, which is also what keeps the
 * evidence trustworthy rather than self-reported.
 */
export async function runDeploymentStages(input: {
    workspace: string;
    scenario: CorEvaluationScenario;
    model?: string;
    executor: CopilotSdkAgentExecutor;
    stages: EvaluationStageResult[];
    deploymentCommandRunner?: DeploymentReadinessCommandRunner;
}): Promise<void> {
    // The production deploy agent treats `.agents/skills/azure-prepare/SKILL.md` as its
    // mandatory operating manual. Without it the agent improvises, so the run would grade a
    // missing dependency instead of the product.
    let skill: DeploymentSkillProvenance;
    try {
        skill = await ensureDeploymentSkill(input.workspace, {
            cacheRoot: path.join(os.tmpdir(), 'cor-eval-azure-prepare'),
            ref: process.env.COR_EVAL_AZURE_PREPARE_REF,
        });
    } catch (error) {
        throw new StageFailure(
            'deploy-generate',
            'deploymentSkillUnavailable',
            error instanceof Error ? error.message : String(error),
        );
    }
    input.stages.push({ name: 'deploy-skill', deploymentSkill: skill, gateCalled: true });

    const deployGate = { called: false };
    const deployRun = await input.executor.run({
        agentName: 'azure-deploy',
        prompt: '[AUTOPILOT MODE] The project runs locally. Write `.azure/deployment-plan.md`, then generate every deployment artifact it specifies (infra, `azure.yaml`, Dockerfiles).',
        workingDirectory: input.workspace,
        model: input.model,
        timeoutMs: input.scenario.validation.timeoutMinutes * 60 * 1000,
        builtInTools: workspaceFileTools,
        additionalSystemMessage: [
            'The evaluator, not this agent, owns all command execution in an isolated environment.',
            'Do not run shell commands, azd, docker, or network requests, and do not fabricate validation evidence.',
            'Autopilot is active: the deployment plan is auto-approved, so do not wait for a user.',
            'Write the deployment plan, generate the complete infra, azure.yaml and Dockerfile set, then call open_deployment_next_steps_view and stop.',
        ].join(' '),
        tools: createDeploymentTools(deployGate),
        completionToolNames: ['open_deployment_next_steps_view'],
    });
    const deployStage: EvaluationStageResult = {
        name: 'deploy-generate',
        agentRun: deployRun,
        gateCalled: deployGate.called,
    };
    input.stages.push(deployStage);
    assertAgentRunCompleted('deploy-generate', deployRun, input.model);

    const readiness = await evaluateDeploymentReadiness(
        { workspace: input.workspace },
        input.deploymentCommandRunner ?? createLocalDeploymentCommandRunner(input.workspace),
    );
    input.stages.push({
        name: 'deploy-readiness',
        deploymentReadiness: readiness,
        gateCalled: deployGate.called,
    });
    // An infrastructure failure still means the deploy gate rendered no verdict. Swallowing it here
    // would let the run report autonomous_success on evidence it never collected; throwing lets the
    // report classify it as infrastructure and exclude the attempt instead of counting it as a pass.
    if (readiness.outcome !== 'passed') {
        throw new StageFailure(
            'deploy-readiness',
            readiness.failureCode ?? 'deploymentArtifactsInvalid',
            readiness.error ?? 'Deployment readiness failed.',
        );
    }
}

function createDeploymentTools(gate: { called: boolean }): CorAgentToolDefinition[] {
    return [
        {
            name: 'open_deployment_next_steps_view',
            description: 'Record that every deployment artifact has been generated for evaluator validation, then stop.',
            parameters: emptyObjectSchema,
            handler: () => {
                gate.called = true;
                return { message: 'Deployment artifact hand-off recorded. Stop and wait for isolated validation.' };
            },
        },
        {
            name: 'open_deploy_plan_view',
            description: 'Open the deployment plan preview. Autopilot approves it immediately.',
            parameters: emptyObjectSchema,
            handler: () => ({
                message: 'Autopilot is active and the deployment plan is approved. Generate the deployment artifacts now.',
            }),
        },
    ];
}

function createDebugPlanTools(gate: { called: boolean }): CorAgentToolDefinition[] {
    return [
        {
            name: 'start_azure_debug_generate',
            description: 'Record that the approved local-debug plan is ready for artifact generation, then stop.',
            parameters: {
                type: 'object',
                properties: { prompt: { type: 'string' } },
                additionalProperties: false,
            },
            handler: () => {
                gate.called = true;
                return { message: 'Local-debug plan hand-off recorded. Stop and wait for the automated evaluator.' };
            },
        },
        {
            name: 'open_local_plan_view',
            description: 'Record an unexpected guided-mode local plan preview request.',
            parameters: emptyObjectSchema,
            handler: () => ({ message: 'Autopilot is active. Approve the plan and call start_azure_debug_generate.' }),
        },
    ];
}

function createDebugGenerateTools(gate: { called: boolean }): CorAgentToolDefinition[] {
    return [
        {
            name: 'open_local_next_steps_view',
            description: 'Record that all local-debug artifacts have been generated for evaluator validation, then stop.',
            parameters: {
                type: 'object',
                properties: { hasApiTests: { type: 'boolean' } },
                required: ['hasApiTests'],
                additionalProperties: false,
            },
            handler: () => {
                gate.called = true;
                return { message: 'Local-debug artifact hand-off recorded. Stop and wait for isolated validation.' };
            },
        },
        {
            name: 'start_deployment',
            description: 'Deployment begins only after evaluator-owned local validation.',
            parameters: {
                type: 'object',
                properties: { prompt: { type: 'string' } },
                additionalProperties: false,
            },
            handler: () => ({
                message: 'Stop. Local validation is owned by the evaluator, which starts deployment itself.',
            }),
        },
    ];
}

function assertAgentRunCompleted(
    stage: EvaluationStageResult['name'],
    agentRun: CorAgentRunResult,
    requestedModel?: string,
): void {
    const modelFailure = validatePinnedModel(requestedModel, agentRun.usage.models);
    if (modelFailure) {
        throw new StageFailure(stage, modelFailure.code, modelFailure.message);
    }
    if (agentRun.outcome !== 'completed') {
        const errorText = agentRun.errors.join('; ');
        // A session that never reports idle is a stalled harness, not a project the product built
        // badly. Keeping it under agentRunFailed counts infrastructure flakes as product failures.
        const timedOut = /Timeout after \d+ms waiting for session\.idle/u.test(errorText);
        // An upstream turn that starts and never streams anything is the same class of fault,
        // caught early by the stall watchdog instead of burning the full timeout budget.
        const stalled = errorText.includes(agentStallMessagePrefix);
        throw new StageFailure(
            stage,
            agentRun.errors.some(error => error.startsWith('SDK cleanup:'))
                ? 'agentCleanupFailed'
                : stalled ? 'agentRunStalled' : timedOut ? 'agentRunTimedOut' : 'agentRunFailed',
            errorText || `Agent outcome was ${agentRun.outcome}.`,
        );
    }
}

function assertArtifactStageSucceeded(
    stage: EvaluationStageResult['name'],
    validation: ArtifactValidationResult,
    gateCalled: boolean,
): void {
    if (!gateCalled) {
        throw new StageFailure(stage, 'gateNotCalled', `Agent did not call the ${stage} review gate.`);
    }
    if (!validation.valid) {
        throw new StageFailure(stage, 'artifactInvalid', validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
    }
}

function combineValidationResults(
    ...results: ArtifactValidationResult[]
): ArtifactValidationResult {
    const issues = results.flatMap(result => result.issues);
    return {
        valid: issues.length === 0,
        issues,
    };
}

async function runDryValidation(repoRoot: string, scenarios: CorEvaluationScenario[]): Promise<void> {
    await computeAgentAssetsHash(repoRoot);
    const fixtureRoot = path.join(repoRoot, 'test', 'testProjects', 'copilotOnRails');
    const fixtureNames = await fs.readdir(fixtureRoot);
    for (const name of fixtureNames) {
        const requirementsPath = path.join(fixtureRoot, name, 'requirements.json');
        const planPath = path.join(fixtureRoot, name, 'project-plan.md');
        const requirements = validateRequirementsArtifact(await readRequiredFile(requirementsPath), { requireConfirmed: true });
        const plan = validateProjectPlanArtifact(await readRequiredFile(planPath));
        if (!requirements.valid || !plan.valid) {
            const messages = [...requirements.issues, ...plan.issues]
                .map(value => `${value.path}: ${value.message}`)
                .join('; ');
            throw new Error(`Production fixture "${name}" failed evaluation validation: ${messages}`);
        }
    }
    process.stdout.write(`Validated ${scenarios.length} scenarios and ${fixtureNames.length} production fixtures without model calls.\n`);
}

export function parseRunArgs(args: string[]): RunOptions {
    const options: RunOptions = { attempts: 1, concurrency: 1, dryRun: false, through: 'plan' };
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
                if (value !== 'plan' && value !== 'scaffold' && value !== 'local' && value !== 'deploy') {
                    throw new Error('--through must be "plan", "scaffold", "local", or "deploy".');
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
        throw new Error('--model is required for a real treatment run; ambient model defaults are not permitted.');
    }
    if (options.model !== undefined && !options.model.trim()) {
        throw new Error('--model must be a non-empty model id.');
    }
    return options;
}

function isThrough(actual: RunOptions['through'], required: RunOptions['through']): boolean {
    const order: RunOptions['through'][] = ['plan', 'scaffold', 'local', 'deploy'];
    return order.indexOf(actual) >= order.indexOf(required);
}

async function runWithConcurrency<T>(
    values: T[],
    concurrency: number,
    operation: (value: T) => Promise<void>,
): Promise<void> {
    let nextIndex = 0;
    await Promise.all(Array.from(
        { length: Math.min(concurrency, values.length) },
        async () => {
            while (nextIndex < values.length) {
                const value = values[nextIndex++];
                await operation(value);
            }
        },
    ));
}

function planHasFrontend(content: string): boolean {
    const appType = /^\*\*App Type\*\*:\s*(.+)$/im.exec(content)?.[1]?.trim().toLowerCase();
    return appType !== 'api only' && appType !== 'background worker';
}

function scenarioHasFrontend(scenario: CorEvaluationScenario): boolean {
    return scenario.tags.frontend !== 'none';
}

function requireValue(args: string[], index: number, option: string): string {
    const value = args[index];
    if (!value) {
        throw new Error(`${option} requires a value.`);
    }
    return value;
}

function getCandidateCommit(repoRoot: string): string {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
    }).trim();
}

async function readRequiredFile(filePath: string): Promise<string> {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch (error) {
        throw new Error(`Required artifact is missing: ${filePath}. ${getErrorMessage(error)}`, { cause: error });
    }
}

async function readRequiredArtifact(
    stage: EvaluationStageResult['name'],
    filePath: string,
): Promise<string> {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch (error) {
        throw new StageFailure(
            stage,
            'artifactMissing',
            `Required artifact is missing: ${filePath}. ${getErrorMessage(error)}`,
        );
    }
}

async function archiveIfPresent(source: string, destination: string): Promise<void> {
    try {
        await fs.cp(source, destination, { recursive: true, force: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
}

export class StageFailure extends Error {
    public constructor(
        public readonly stage: EvaluationStageResult['name'],
        public readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

function toQualityFailure(failure: StageFailure): EvaluationQualityFailure {
    return {
        stage: failure.stage,
        code: failure.code,
        category: 'product_failure',
        error: failure.message,
    };
}

function createHarnessFailureResult(input: {
    scenario: CorEvaluationScenario;
    attempt: number;
    candidateCommit: string;
    agentAssetsHash: string;
    evaluationDefinition: EvaluationDefinitionProvenance;
    model?: string;
    error: unknown;
}): EvaluationAttemptResult {
    return {
        schemaVersion: '1',
        evaluationArm: 'rails',
        runId: `${input.scenario.id}-${input.attempt}-${Date.now()}`,
        scenarioId: input.scenario.id,
        attempt: input.attempt,
        candidateCommit: input.candidateCommit,
        agentAssetsHash: input.agentAssetsHash,
        evaluationDefinition: input.evaluationDefinition,
        model: input.model,
        requestedModel: input.model,
        observedModels: [],
        outcome: 'failed',
        failedStage: 'harness',
        failureCode: 'attemptExecutionFailed',
        failureCategory: 'harness_failure',
        error: getErrorMessage(input.error),
        durationMs: 0,
        agentRetries: 0,
        stages: [],
    };
}

export function observedModels(stages: EvaluationStageResult[]): string[] {
    return unique(stages.flatMap(stage => stage.agentRun?.usage.models ?? []));
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function shouldRepair(
    validation: SandboxProjectValidationResult,
    repairBudget: AgentRepairBudget,
): boolean {
    return validation.outcome === 'failed'
        && repairBudget.usedRetries < repairBudget.maxRetries
        && !isSandboxInfrastructureFailureCode(validation.failureCode);
}

async function createRepairPrompt(
    validation: SandboxProjectValidationResult,
    repairAttempt: number,
    workspace: string,
): Promise<string> {
    const failedCommand = validation.commands.find(command => !command.success);
    const evidence = {
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
    // A bare "npm test failed" tells the agent nothing, and it has only two repairs for the whole
    // run. Attach any deterministic contract hit so the first attempt targets the real cause.
    const diagnosed = await diagnoseGeneratedCode(workspace).catch(() => []);
    return [
        `[AUTOPILOT REPAIR MODE] Repair attempt ${repairAttempt}.`,
        'The evaluator ran the generated project in an isolated ACA sandbox and received the validation failure below.',
        'Inspect the existing files, fix the root cause, and stop after writing the edits. Do not run commands.',
        '```json',
        JSON.stringify(evidence, null, 2),
        '```',
        ...(diagnosed.length
            ? [
                '',
                'The evaluator also ran deterministic checks over the generated source and found the '
                + 'following. These are exact, verified defects — fix them first, as they are the most '
                + 'likely root cause of the failure above:',
                ...diagnosed.map(issue => `- (${issue.code}) ${issue.path}: ${issue.message}`),
            ]
            : []),
    ].join('\n');
}

function createLocalArtifactRepairPrompt(
    validation: ArtifactValidationResult,
    repairAttempt: number,
): string {
    return createLocalRepairPrompt(repairAttempt, {
        stage: 'local-artifacts',
        issues: validation.issues,
    });
}

function createLocalRuntimeRepairPrompt(
    validation: SandboxLocalRuntimeValidationResult,
    repairAttempt: number,
): string {
    const failedCommand = validation.commands.find(command => !command.success);
    const diagnostics = validation.commands
        .filter(command => command.kind === 'diagnostic')
        .slice(-2)
        .map(command => ({
            name: command.name,
            stdout: command.stdout,
            stderr: command.stderr,
        }));
    return createLocalRepairPrompt(repairAttempt, {
        stage: 'local-runtime',
        failureCode: validation.failureCode,
        error: validation.error,
        failedCommand: failedCommand && {
            name: failedCommand.name,
            command: failedCommand.command,
            stdout: failedCommand.stdout,
            stderr: failedCommand.stderr,
        },
        probes: validation.probes,
        diagnostics,
    });
}

function createLocalRepairPrompt(repairAttempt: number, evidence: unknown): string {
    const serializedEvidence = sanitizeRepairEvidence(JSON.stringify(evidence, null, 2));
    return [
        `[AUTOPILOT LOCAL DEBUG REPAIR MODE] Repair attempt ${repairAttempt}.`,
        'The evaluator validated the generated local-debug setup in an isolated ACA sandbox and received the failure below.',
        'Inspect the existing artifacts, fix the root cause, and stop after writing the edits. Do not run commands.',
        '```json',
        serializedEvidence,
        '```',
    ].join('\n');
}

function sanitizeRepairEvidence(value: string): string {
    const redacted = value
        .replace(/(AccountKey=)[^;"\s]+/gi, '$1[REDACTED]')
        .replace(/((?:password|passwd|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
        .replace(/(Authorization["']?\s*:\s*["']?)[^\r\n"']+/gi, '$1[REDACTED]');
    const maxEvidenceLength = 16_000;
    return redacted.length <= maxEvidenceLength
        ? redacted
        : `${redacted.slice(0, maxEvidenceLength)}\n[truncated]`;
}

function classifyFailure(error: unknown): {
    stage: EvaluationAttemptResult['failedStage'];
    code: string;
    category: EvaluationFailureCategory;
} {
    if (!(error instanceof StageFailure)) {
        return {
            stage: 'harness',
            code: 'harnessError',
            category: 'harness_failure',
        };
    }
    return {
        stage: error.stage,
        code: error.code,
        category: ['acceptanceSpecMissing', 'agentCleanupFailed', 'modelMismatch', 'modelNotObserved'].includes(error.code)
            ? 'harness_failure'
            : isSandboxInfrastructureFailureCode(error.code) || isLocalRuntimeInfrastructureFailureCode(error.code)
                ? 'infrastructure_failure'
                : 'product_failure',
    };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

if (require.main === module) {
    void main().catch(error => {
        console.error(getErrorMessage(error));
        process.exitCode = 1;
    });
}
