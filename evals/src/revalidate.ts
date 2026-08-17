/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import {
    isSandboxInfrastructureFailureCode,
    SandboxProjectValidationResult,
    SandboxProjectValidator,
} from './SandboxProjectValidator';
import {
    isLocalRuntimeInfrastructureFailureCode,
    SandboxLocalRuntimeValidationResult,
    SandboxLocalRuntimeValidator,
} from './SandboxLocalRuntimeValidator';
import { validateLocalDebugArtifacts } from './artifacts/localDebug';
import { CorEvaluationScenario, loadScenarios } from './scenario';
import {
    EvaluationDefinitionProvenance,
    computeEvaluationDefinition,
    sameEvaluationDefinition,
} from './evaluationDefinition';

interface RevalidationOptions {
    inputDirectory: string;
    outputDirectory: string;
    concurrency: number;
    stage: 'build' | 'local';
}

interface EvaluationStage {
    name: string;
    buildValidation?: SandboxProjectValidationResult;
    localRuntimeValidation?: SandboxLocalRuntimeValidationResult;
    [key: string]: unknown;
}

interface EvaluationAttempt {
    runId: string;
    scenarioId: string;
    attempt: number;
    outcome: 'autonomous_success' | 'failed';
    failedStage?: string;
    failureCode?: string;
    failureCategory?: 'product_failure' | 'harness_failure' | 'infrastructure_failure';
    error?: string;
    durationMs: number;
    stages: EvaluationStage[];
    evaluationDefinition?: EvaluationDefinitionProvenance;
    [key: string]: unknown;
}

interface EvaluationSummary {
    startedAt: string;
    completedAt: string;
    attempts: number;
    successes: number;
    failures: number;
    results: EvaluationAttempt[];
    [key: string]: unknown;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const source = await readSummary(options.inputDirectory);
    const currentDefinitions = new Map<string, Awaited<ReturnType<typeof computeEvaluationDefinition>>>();
    for (const attempt of source.results) {
        const definition = attempt.evaluationDefinition;
        if (definition) {
            const key = JSON.stringify(definition.scenarioIds);
            let current = currentDefinitions.get(key);
            if (!current) {
                current = await computeEvaluationDefinition(repoRoot, definition.scenarioIds);
                currentDefinitions.set(key, current);
            }
            if (!sameEvaluationDefinition(definition, current)) {
                throw new Error(
                    `Revalidation source "${attempt.runId}" evaluation definition does not match the current checkout.`,
                );
            }
        }
    }
    const scenarios = new Map(
        (await loadScenarios(path.join(repoRoot, 'evals', 'scenarios')))
            .map(scenario => [scenario.id, scenario]),
    );
    const validator = new SandboxProjectValidator(repoRoot);
    const localValidator = new SandboxLocalRuntimeValidator(repoRoot);
    const startedAt = new Date().toISOString();
    const results: EvaluationAttempt[] = [];

    await fs.mkdir(options.outputDirectory, { recursive: true });
    await runWithConcurrency(source.results, options.concurrency, async attempt => {
        const result = await revalidateAttempt(
            attempt,
            scenarios,
            options.inputDirectory,
            validator,
            localValidator,
            options.stage,
            startedAt,
        );
        results.push(result);
        const resultDirectory = path.join(options.outputDirectory, result.runId);
        await fs.mkdir(resultDirectory, { recursive: true });
        await fs.writeFile(
            path.join(resultDirectory, 'run-result.json'),
            JSON.stringify(result, null, 2) + '\n',
        );
        process.stdout.write(
            `${result.outcome === 'autonomous_success' ? 'PASS' : 'FAIL'} ${result.scenarioId} attempt ${result.attempt}\n`,
        );
    });

    results.sort((left, right) =>
        left.scenarioId.localeCompare(right.scenarioId) || left.attempt - right.attempt);
    const summary: EvaluationSummary = {
        ...source,
        completedAt: new Date().toISOString(),
        attempts: results.length,
        successes: results.filter(result => result.outcome === 'autonomous_success').length,
        failures: results.filter(result => result.outcome === 'failed').length,
        results,
        revalidatedFrom: options.inputDirectory,
        revalidationStartedAt: startedAt,
    };
    await fs.writeFile(
        path.join(options.outputDirectory, 'summary.json'),
        JSON.stringify(summary, null, 2) + '\n',
    );
    process.stdout.write(`Results: ${options.outputDirectory}\n`);
    if (summary.failures > 0) {
        process.exitCode = 1;
    }
}

async function revalidateAttempt(
    attempt: EvaluationAttempt,
    scenarios: Map<string, CorEvaluationScenario>,
    inputDirectory: string,
    validator: SandboxProjectValidator,
    localValidator: SandboxLocalRuntimeValidator,
    stage: RevalidationOptions['stage'],
    startedAt: string,
): Promise<EvaluationAttempt> {
    const started = Date.now();
    const sourceWorkspace = path.join(inputDirectory, attempt.runId, 'workspace');
    try {
        const scenario = scenarios.get(attempt.scenarioId);
        if (!scenario) {
            throw new Error(`Unknown scenario "${attempt.scenarioId}".`);
        }
        if (stage === 'local') {
            const planPath = path.join(sourceWorkspace, '.azure', 'vscode-debug-plan.md');
            const planContent = await fs.readFile(planPath, 'utf8');
            const artifactValidation = await validateLocalDebugArtifacts(
                sourceWorkspace,
                planContent,
                { requireSuccessfulChecklist: false },
            );
            if (!artifactValidation.valid) {
                return applyLocalRevalidation(attempt, {
                    outcome: 'failed',
                    failureCode: 'debugTaskGraphInvalid',
                    error: artifactValidation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '),
                    commands: [],
                    probes: [],
                }, artifactValidation, Date.now() - started, { sourceWorkspace, startedAt });
            }
            const validation = await localValidator.validate(sourceWorkspace, scenario, planContent);
            return applyLocalRevalidation(
                attempt,
                validation,
                artifactValidation,
                Date.now() - started,
                { sourceWorkspace, startedAt },
            );
        }
        const validation = await validator.validate(sourceWorkspace, scenario);
        return applyBuildRevalidation(attempt, validation, Date.now() - started, { sourceWorkspace, startedAt });
    } catch (error) {
        return {
            ...attempt,
            outcome: 'failed',
            failedStage: 'harness',
            failureCode: 'revalidationHarnessError',
            failureCategory: 'harness_failure',
            error: error instanceof Error ? error.message : String(error),
            durationMs: attempt.durationMs + Date.now() - started,
            revalidation: {
                sourceWorkspace,
                startedAt,
            },
        };
    }
}

export function applyLocalRevalidation(
    attempt: EvaluationAttempt,
    validation: SandboxLocalRuntimeValidationResult,
    artifactValidation: import('./artifacts/validationTypes').ArtifactValidationResult,
    durationMs: number,
    provenance: { sourceWorkspace: string; startedAt: string },
): EvaluationAttempt {
    const stages = [
        ...attempt.stages.filter(stage => stage.name !== 'local-artifacts' && stage.name !== 'local-runtime'),
        { name: 'local-artifacts', validation: artifactValidation },
        { name: 'local-runtime', localRuntimeValidation: validation },
    ];
    const common = {
        ...attempt,
        durationMs: attempt.durationMs + durationMs,
        stages,
        revalidation: {
            ...provenance,
            stage: 'local',
            durationMs,
        },
    };
    if (artifactValidation.valid && validation.outcome === 'passed') {
        return promoteRevalidatedAttempt(common, ['local-artifacts', 'local-runtime']);
    }
    if (hasUnrelatedFailure(common, ['local-artifacts', 'local-runtime'])) {
        return common;
    }
    const code = validation.failureCode ?? 'localRuntimeValidationFailed';
    return {
        ...common,
        outcome: 'failed',
        failedStage: artifactValidation.valid ? 'local-runtime' : 'local-artifacts',
        failureCode: code,
        failureCategory: code === 'acceptanceSpecMissing'
            ? 'harness_failure'
            : isLocalRuntimeInfrastructureFailureCode(code)
                ? 'infrastructure_failure'
                : 'product_failure',
        error: validation.error ?? 'Generated local-debug setup failed isolated runtime validation.',
    };
}

export function applyBuildRevalidation(
    attempt: EvaluationAttempt,
    validation: SandboxProjectValidationResult,
    durationMs: number,
    provenance: { sourceWorkspace: string; startedAt: string },
): EvaluationAttempt {
    const stages = [
        ...attempt.stages.filter(stage => stage.name !== 'build'),
        { name: 'build', buildValidation: validation },
    ];
    const common = {
        ...attempt,
        durationMs: attempt.durationMs + durationMs,
        stages,
        revalidation: {
            ...provenance,
            durationMs,
        },
    };
    if (validation.outcome === 'passed') {
        return promoteRevalidatedAttempt(common, ['build']);
    }
    if (hasUnrelatedFailure(common, ['build'])) {
        return common;
    }

    return {
        ...common,
        outcome: 'failed',
        failedStage: 'build',
        failureCode: validation.failureCode ?? 'buildValidationFailed',
        failureCategory: isSandboxInfrastructureFailureCode(validation.failureCode)
            ? 'infrastructure_failure'
            : 'product_failure',
        error: validation.error ?? 'Generated project validation failed.',
    };
}

function promoteRevalidatedAttempt(
    attempt: EvaluationAttempt,
    revalidatedStages: string[],
): EvaluationAttempt {
    if (
        attempt.outcome === 'failed'
        && attempt.failedStage !== undefined
        && !revalidatedStages.includes(attempt.failedStage)
    ) {
        return attempt;
    }

    const passed: EvaluationAttempt = { ...attempt, outcome: 'autonomous_success' };
    delete passed.failedStage;
    delete passed.failureCode;
    delete passed.failureCategory;
    delete passed.error;
    return passed;
}

function hasUnrelatedFailure(attempt: EvaluationAttempt, revalidatedStages: string[]): boolean {
    return attempt.outcome === 'failed'
        && attempt.failedStage !== undefined
        && !revalidatedStages.includes(attempt.failedStage);
}

async function readSummary(inputDirectory: string): Promise<EvaluationSummary> {
    const value: unknown = JSON.parse(
        await fs.readFile(path.join(inputDirectory, 'summary.json'), 'utf8'),
    );
    if (!value || typeof value !== 'object' || !Array.isArray((value as EvaluationSummary).results)) {
        throw new Error(`Invalid evaluation summary: ${inputDirectory}`);
    }
    return value as EvaluationSummary;
}

async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
): Promise<void> {
    let nextIndex = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            await worker(items[index]);
        }
    }));
}

function parseArgs(args: string[]): RevalidationOptions {
    const options: Partial<RevalidationOptions> = {
        concurrency: 1,
        stage: 'build',
    };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        switch (arg) {
            case '--input':
                options.inputDirectory = path.resolve(requireValue(args, ++index, arg));
                break;
            case '--output':
                options.outputDirectory = path.resolve(requireValue(args, ++index, arg));
                break;
            case '--concurrency':
                options.concurrency = Number(requireValue(args, ++index, arg));
                break;
            case '--stage': {
                const stage = requireValue(args, ++index, arg);
                if (stage !== 'build' && stage !== 'local') {
                    throw new Error('--stage must be "build" or "local".');
                }
                options.stage = stage;
                break;
            }
            default:
                throw new Error(`Unknown argument "${arg}".`);
        }
    }
    if (!options.inputDirectory || !options.outputDirectory) {
        throw new Error('--input and --output are required.');
    }
    const concurrency = options.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
        throw new Error('--concurrency must be an integer from 1 to 10.');
    }
    return {
        inputDirectory: options.inputDirectory,
        outputDirectory: options.outputDirectory,
        concurrency,
        stage: options.stage ?? 'build',
    };
}

function requireValue(args: string[], index: number, option: string): string {
    const value = args[index];
    if (!value) {
        throw new Error(`${option} requires a value.`);
    }
    return value;
}

if (require.main === module) {
    void main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
