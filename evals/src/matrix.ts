/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { EvaluationSummary, createReport, renderMarkdown } from './report';
import {
    EvaluationDefinitionProvenance,
    computeEvaluationDefinition,
    isEvaluationDefinitionProvenance,
    sameEvaluationDefinition,
} from './evaluationDefinition';
import { CorEvaluationScenario, loadScenarios } from './scenario';

export type MatrixArm = 'rails' | 'baseline-controlled';
export type MatrixThrough = 'scaffold' | 'local';

export interface MatrixOptions {
    models: string[];
    scenarioIds: string[];
    attempts: number;
    through: MatrixThrough;
    concurrency: number;
    seed: string;
    outputDirectory: string;
    dryRun: boolean;
}

export interface MatrixJob {
    order: number;
    jobId: string;
    pairingKey: string;
    arm: MatrixArm;
    model: string;
    modelDirectory: string;
    scenarioId: string;
    attempt: number;
    through: MatrixThrough;
    outputDirectory: string;
}

export interface MatrixManifest {
    schemaVersion: '1';
    kind: 'copilot-on-rails-model-matrix';
    dryRun: boolean;
    seed: string;
    models: { id: string; directory: string }[];
    scenarioIds: string[];
    attempts: number;
    through: MatrixThrough;
    concurrency: number;
    pairing: 'model+scenarioId+attempt';
    evaluationDefinition?: EvaluationDefinitionProvenance;
    schedule: MatrixJob[];
}

interface CompletedMatrixJob extends MatrixJob {
    exitCode: number;
    summaryPath: string;
}

const defaultSeed = 'copilot-on-rails-matrix-v1';

async function main(): Promise<void> {
    const repoRoot = process.cwd();
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        process.stdout.write(matrixUsage);
        return;
    }

    const options = parseMatrixArgs(args);
    const allScenarios = await loadScenarios(path.join(repoRoot, 'evals', 'scenarios'));
    validateMatrixScenarios(options.scenarioIds, allScenarios);
    const evaluationDefinition = await computeEvaluationDefinition(repoRoot, options.scenarioIds);
    const manifest = createMatrixManifest(options, evaluationDefinition);
    const outputDirectory = path.resolve(options.outputDirectory);
    await fs.mkdir(outputDirectory, { recursive: true });
    const manifestPath = path.join(outputDirectory, 'matrix-manifest.json');
    await writeJson(manifestPath, manifest);
    if (options.dryRun) {
        process.stdout.write(`Matrix manifest: ${manifestPath}\n`);
        return;
    }

    const completed = await executeSchedule(repoRoot, outputDirectory, manifest.schedule, options.concurrency);
    const reports = await createModelReports(outputDirectory, completed, allScenarios);
    const summary = {
        schemaVersion: '1',
        kind: 'copilot-on-rails-model-matrix-summary',
        manifest: 'matrix-manifest.json',
        seed: manifest.seed,
        through: manifest.through,
        models: manifest.models,
        scenarioIds: manifest.scenarioIds,
        attempts: manifest.attempts,
        evaluationDefinition: manifest.evaluationDefinition,
        jobs: completed.map(job => ({
            order: job.order,
            jobId: job.jobId,
            pairingKey: job.pairingKey,
            arm: job.arm,
            model: job.model,
            scenarioId: job.scenarioId,
            attempt: job.attempt,
            exitCode: job.exitCode,
            summary: relativePath(outputDirectory, job.summaryPath),
        })),
        reports,
    };
    await writeJson(path.join(outputDirectory, 'matrix-summary.json'), summary);
    process.stdout.write(`Matrix summary: ${path.join(outputDirectory, 'matrix-summary.json')}\n`);
    if (completed.some(job => job.exitCode !== 0)) {
        process.exitCode = 1;
    }
}

export function parseMatrixArgs(args: string[]): MatrixOptions {
    const options: MatrixOptions = {
        models: [],
        scenarioIds: [],
        attempts: 1,
        through: 'scaffold',
        concurrency: 1,
        seed: defaultSeed,
        outputDirectory: path.join('evals', 'results', 'matrix'),
        dryRun: false,
    };
    for (let index = 0; index < args.length; index++) {
        const [arg, inlineValue] = splitInlineOption(args[index]);
        switch (arg) {
            case '--models':
                options.models.push(...parseList(inlineValue ?? requireValue(args, ++index, arg), arg));
                break;
            case '--scenarios':
                options.scenarioIds.push(...parseList(inlineValue ?? requireValue(args, ++index, arg), arg));
                break;
            case '--attempts':
                options.attempts = Number(inlineValue ?? requireValue(args, ++index, arg));
                break;
            case '--through': {
                const value = inlineValue ?? requireValue(args, ++index, arg);
                if (value !== 'scaffold' && value !== 'local') {
                    throw new Error('--through must be "scaffold" or "local".');
                }
                options.through = value;
                break;
            }
            case '--concurrency':
                options.concurrency = Number(inlineValue ?? requireValue(args, ++index, arg));
                break;
            case '--seed':
                options.seed = inlineValue ?? requireValue(args, ++index, arg);
                break;
            case '--output':
                options.outputDirectory = inlineValue ?? requireValue(args, ++index, arg);
                break;
            case '--dry-run':
                if (inlineValue !== undefined) {
                    throw new Error('--dry-run does not accept a value.');
                }
                options.dryRun = true;
                break;
            default:
                throw new Error(`Unknown argument "${args[index]}".`);
        }
    }

    options.models = validateUniqueValues(options.models, '--models');
    options.scenarioIds = validateUniqueValues(options.scenarioIds, '--scenarios');
    if (!options.models.length) {
        throw new Error('At least one explicit --models value is required; ambient model defaults are not permitted.');
    }
    if (!options.scenarioIds.length) {
        throw new Error('At least one explicit --scenarios value is required.');
    }
    if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 50) {
        throw new Error('--attempts must be an integer from 1 to 50.');
    }
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 10) {
        throw new Error('--concurrency must be an integer from 1 to 10.');
    }
    if (!options.seed.trim()) {
        throw new Error('--seed must be a non-empty deterministic seed.');
    }
    if (!options.outputDirectory.trim()) {
        throw new Error('--output must be a non-empty directory.');
    }
    createModelDirectoryMap(options.models);
    return options;
}

export function createMatrixManifest(
    options: MatrixOptions,
    evaluationDefinition?: EvaluationDefinitionProvenance,
): MatrixManifest {
    const modelDirectories = createModelDirectoryMap(options.models);
    const random = createSeededRandom(options.seed);
    const pairs = options.models.flatMap(model =>
        options.scenarioIds.flatMap(scenarioId =>
            Array.from({ length: options.attempts }, (_, index) => ({
                model,
                modelDirectory: modelDirectories.get(model) as string,
                scenarioId,
                attempt: index + 1,
            }))));
    shuffle(pairs, random);
    const schedule: MatrixJob[] = [];
    for (const pair of pairs) {
        const arms: MatrixArm[] = random() < 0.5
            ? ['rails', 'baseline-controlled']
            : ['baseline-controlled', 'rails'];
        for (const arm of arms) {
            const order = schedule.length + 1;
            const jobId = `job-${String(order).padStart(4, '0')}`;
            schedule.push({
                order,
                jobId,
                pairingKey: matrixPairingKey(pair.model, pair.scenarioId, pair.attempt),
                arm,
                model: pair.model,
                modelDirectory: pair.modelDirectory,
                scenarioId: pair.scenarioId,
                attempt: pair.attempt,
                through: options.through,
                outputDirectory: `models/${pair.modelDirectory}/jobs/${jobId}`,
            });
        }
    }
    return {
        schemaVersion: '1',
        kind: 'copilot-on-rails-model-matrix',
        dryRun: options.dryRun,
        seed: options.seed,
        models: options.models.map(id => ({ id, directory: modelDirectories.get(id) as string })),
        scenarioIds: [...options.scenarioIds],
        attempts: options.attempts,
        through: options.through,
        concurrency: options.concurrency,
        pairing: 'model+scenarioId+attempt',
        evaluationDefinition,
        schedule,
    };
}

export function matrixPairingKey(model: string, scenarioId: string, attempt: number): string {
    return JSON.stringify([model, scenarioId, attempt]);
}

export function sanitizeModelDirectory(model: string): string {
    const directory = model
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/[-_.]{2,}/g, '-')
        .replace(/^[-_.]+|[-_.]+$/g, '')
        .slice(0, 80)
        .replace(/^[-_.]+|[-_.]+$/g, '');
    return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(directory)
        ? `model-${directory}`
        : directory;
}

export function createModelDirectoryMap(models: string[]): Map<string, string> {
    const result = new Map<string, string>();
    const owners = new Map<string, string>();
    for (const model of models) {
        if (result.has(model)) {
            throw new Error(`Duplicate model id "${model}".`);
        }
        const directory = sanitizeModelDirectory(model);
        if (!directory) {
            throw new Error(`Model id "${model}" cannot be converted to a safe directory name.`);
        }
        const previous = owners.get(directory);
        if (previous !== undefined && previous !== model) {
            throw new Error(
                `Model ids "${previous}" and "${model}" collide in directory name "${directory}".`,
            );
        }
        owners.set(directory, model);
        result.set(model, directory);
    }
    return result;
}

export function validateMatrixScenarios(
    scenarioIds: string[],
    scenarios: CorEvaluationScenario[],
): void {
    const known = new Set(scenarios.map(scenario => scenario.id));
    const unknown = scenarioIds.filter(id => !known.has(id));
    if (unknown.length) {
        throw new Error(`Unknown scenario${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
    }
}

async function executeSchedule(
    repoRoot: string,
    outputDirectory: string,
    schedule: MatrixJob[],
    concurrency: number,
): Promise<CompletedMatrixJob[]> {
    const completed: CompletedMatrixJob[] = [];
    let nextIndex = 0;
    let orchestrationError: Error | undefined;
    await Promise.all(Array.from({ length: Math.min(concurrency, schedule.length) }, async () => {
        while (!orchestrationError && nextIndex < schedule.length) {
            const job = schedule[nextIndex++];
            try {
                completed.push(await executeJob(repoRoot, outputDirectory, job));
            } catch (error) {
                orchestrationError = error instanceof Error ? error : new Error(String(error));
            }
        }
    }));
    if (orchestrationError) {
        throw orchestrationError;
    }
    return completed.sort((left, right) => left.order - right.order);
}

async function executeJob(
    repoRoot: string,
    matrixOutputDirectory: string,
    job: MatrixJob,
): Promise<CompletedMatrixJob> {
    const outputDirectory = path.join(matrixOutputDirectory, job.outputDirectory);
    try {
        await fs.stat(outputDirectory);
        throw new Error(`${job.jobId} output directory already exists: ${outputDirectory}`);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
    await fs.mkdir(outputDirectory, { recursive: true });
    const entryPoint = job.arm === 'rails' ? 'evals/src/run.ts' : 'evals/src/baseline.ts';
    const args = [
        require.resolve('tsx/cli'),
        path.join(repoRoot, entryPoint),
        '--attempts', '1',
        '--concurrency', '1',
        '--through', job.through,
        '--model', job.model,
        '--scenario', job.scenarioId,
        '--output', outputDirectory,
    ];
    process.stdout.write(
        `[${job.order}/${job.jobId}] ${job.arm} ${job.model} ${job.scenarioId} attempt ${job.attempt}\n`,
    );
    const exitCode = await spawnChild(process.execPath, args, repoRoot);
    if (exitCode !== 0 && exitCode !== 1) {
        throw new Error(`${job.jobId} exited with orchestration status ${exitCode}.`);
    }
    const summaryPath = path.join(outputDirectory, 'summary.json');
    const summary = await readSummary(summaryPath, job);
    if (summary.results.length !== 1) {
        throw new Error(`${job.jobId} produced ${summary.results.length} results; expected exactly one.`);
    }
    return { ...job, exitCode, summaryPath };
}

async function createModelReports(
    outputDirectory: string,
    jobs: CompletedMatrixJob[],
    scenarios: CorEvaluationScenario[],
): Promise<{
    model: string;
    railsSummary: string;
    baselineSummary: string;
    reportJson: string;
    reportMarkdown: string;
}[]> {
    const reports = [];
    for (const model of [...new Set(jobs.map(job => job.model))]) {
        const modelJobs = jobs.filter(job => job.model === model);
        const modelDirectory = modelJobs[0].modelDirectory;
        const modelRoot = path.join(outputDirectory, 'models', modelDirectory);
        const railsSummary = await aggregateSummaries(
            modelJobs.filter(job => job.arm === 'rails'),
            'rails',
            model,
        );
        const baselineSummary = await aggregateSummaries(
            modelJobs.filter(job => job.arm === 'baseline-controlled'),
            'baseline-controlled',
            model,
        );
        const railsSummaryPath = path.join(modelRoot, 'rails-summary.json');
        const baselineSummaryPath = path.join(modelRoot, 'baseline-summary.json');
        await Promise.all([
            writeJson(railsSummaryPath, railsSummary),
            writeJson(baselineSummaryPath, baselineSummary),
        ]);
        const report = createReport([railsSummary], scenarios, [baselineSummary]);
        const reportDirectory = path.join(modelRoot, 'report');
        const reportJsonPath = path.join(reportDirectory, 'report.json');
        const reportMarkdownPath = path.join(reportDirectory, 'report.md');
        await fs.mkdir(reportDirectory, { recursive: true });
        await Promise.all([
            writeJson(reportJsonPath, report),
            fs.writeFile(reportMarkdownPath, renderMarkdown(report)),
        ]);
        reports.push({
            model,
            railsSummary: relativePath(outputDirectory, railsSummaryPath),
            baselineSummary: relativePath(outputDirectory, baselineSummaryPath),
            reportJson: relativePath(outputDirectory, reportJsonPath),
            reportMarkdown: relativePath(outputDirectory, reportMarkdownPath),
        });
    }
    return reports;
}

async function aggregateSummaries(
    jobs: CompletedMatrixJob[],
    arm: MatrixArm,
    model: string,
): Promise<EvaluationSummary> {
    if (!jobs.length) {
        throw new Error(`No ${arm} jobs completed for model "${model}".`);
    }
    const values = await Promise.all(jobs.map(async job => ({
        job,
        summary: await readSummary(job.summaryPath, job),
    })));
    const candidateCommits = [...new Set(values.map(value => value.summary.candidateCommit))];
    const assetHashes = [...new Set(values.map(value => value.summary.agentAssetsHash))];
    const through = [...new Set(values.map(value => value.summary.through))];
    if (candidateCommits.length !== 1 || assetHashes.length !== 1 || through.length !== 1) {
        throw new Error(`Cannot aggregate inconsistent ${arm} summaries for model "${model}".`);
    }
    const evaluationDefinitions = collectMatrixEvaluationDefinitions(
        values.map(value => value.summary),
        arm,
        model,
    );
    return {
        candidateCommit: candidateCommits[0],
        agentAssetsHash: assetHashes[0],
        through: through[0],
        evaluationArm: arm,
        requestedModel: arm === 'baseline-controlled' ? model : undefined,
        requestedModels: arm === 'rails' ? [model] : undefined,
        observedModels: [...new Set(values.flatMap(value => value.summary.observedModels ?? []))].sort(),
        ...(evaluationDefinitions ? { evaluationDefinitions } : {}),
        results: values
            .map(({ job, summary }) => ({
                ...summary.results[0],
                attempt: job.attempt,
            }))
            .sort((left, right) =>
                left.scenarioId.localeCompare(right.scenarioId) || left.attempt - right.attempt),
    };
}

export function collectMatrixEvaluationDefinitions(
    summaries: EvaluationSummary[],
    arm: MatrixArm,
    model: string,
): EvaluationDefinitionProvenance[] | undefined {
    const hasModern = summaries.some(summary =>
        summary.evaluationDefinitions !== undefined
        || summary.results.some(result => result.evaluationDefinition !== undefined));
    if (!hasModern) {
        return undefined;
    }
    const definitionsByScenario = new Map<string, EvaluationDefinitionProvenance>();
    for (const summary of summaries) {
        if (
            !Array.isArray(summary.evaluationDefinitions)
            || !summary.evaluationDefinitions.length
            || summary.evaluationDefinitions.some(value => !isEvaluationDefinitionProvenance(value))
        ) {
            throw new Error(`Cannot aggregate ${arm} model "${model}" with missing or malformed modern evaluation provenance.`);
        }
        for (const attempt of summary.results) {
            const definition = attempt.evaluationDefinition;
            if (
                !isEvaluationDefinitionProvenance(definition)
                || !summary.evaluationDefinitions.some(value => sameEvaluationDefinition(value, definition))
                || definition.scenarioIds.length !== 1
                || definition.scenarioIds[0] !== attempt.scenarioId
            ) {
                throw new Error(
                    `Cannot aggregate ${arm} model "${model}": attempt ${attempt.scenarioId}:${attempt.attempt} `
                    + 'has mismatched evaluation-definition provenance.',
                );
            }
            const previous = definitionsByScenario.get(attempt.scenarioId);
            if (previous && !sameEvaluationDefinition(previous, definition)) {
                throw new Error(
                    `Cannot aggregate ${arm} model "${model}": scenario "${attempt.scenarioId}" `
                    + 'changed evaluation definition between attempts.',
                );
            }
            definitionsByScenario.set(attempt.scenarioId, definition);
        }
    }
    const definitions = [...definitionsByScenario.values()]
        .sort((left, right) => left.scenarioIds[0].localeCompare(right.scenarioIds[0]));
    if (
        new Set(definitions.map(value => value.evaluatorHash)).size !== 1
        || new Set(definitions.map(value => value.productContractHash)).size !== 1
    ) {
        throw new Error(
            `Cannot aggregate ${arm} model "${model}": evaluator or product-contract provenance changed during the matrix.`,
        );
    }
    return definitions;
}

async function readSummary(filePath: string, job: MatrixJob): Promise<EvaluationSummary> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
        throw new Error(
            `${job.jobId} did not produce a readable summary at ${filePath}: ${getErrorMessage(error)}`,
            { cause: error },
        );
    }
    if (
        !parsed
        || typeof parsed !== 'object'
        || !Array.isArray((parsed as Partial<EvaluationSummary>).results)
        || (parsed as Partial<EvaluationSummary>).evaluationArm !== job.arm
    ) {
        throw new Error(`${job.jobId} produced an invalid ${job.arm} summary.`);
    }
    return parsed as EvaluationSummary;
}

function spawnChild(executable: string, args: string[], cwd: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, { cwd, stdio: 'inherit' });
        child.once('error', reject);
        child.once('close', (code, signal) => {
            if (signal) {
                reject(new Error(`Evaluator child process terminated by signal ${signal}.`));
            } else {
                resolve(code ?? 1);
            }
        });
    });
}

function createSeededRandom(seed: string): () => number {
    let state = 2166136261;
    for (let index = 0; index < seed.length; index++) {
        state ^= seed.charCodeAt(index);
        state = Math.imul(state, 16777619);
    }
    return () => {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
}

function shuffle<T>(values: T[], random: () => number): void {
    for (let index = values.length - 1; index > 0; index--) {
        const target = Math.floor(random() * (index + 1));
        [values[index], values[target]] = [values[target], values[index]];
    }
}

function validateUniqueValues(values: string[], option: string): string[] {
    const normalized = values.map(value => value.trim());
    if (normalized.some(value => !value)) {
        throw new Error(`${option} values must be non-empty.`);
    }
    const seen = new Set<string>();
    for (const value of normalized) {
        if (seen.has(value)) {
            throw new Error(`Duplicate ${option} value "${value}".`);
        }
        seen.add(value);
    }
    return normalized;
}

function parseList(value: string, option: string): string[] {
    const values = value.split(',');
    if (values.some(item => !item.trim())) {
        throw new Error(`${option} values must be non-empty.`);
    }
    return values;
}

function splitInlineOption(value: string): [string, string | undefined] {
    const equals = value.indexOf('=');
    return equals < 0 ? [value, undefined] : [value.slice(0, equals), value.slice(equals + 1)];
}

function requireValue(args: string[], index: number, option: string): string {
    const value = args[index];
    if (value === undefined || value.startsWith('--')) {
        throw new Error(`${option} requires a value.`);
    }
    return value;
}

function relativePath(root: string, value: string): string {
    return path.relative(root, value).split(path.sep).join('/');
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n');
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const matrixUsage = `Usage: npm run eval:cor:matrix -- --models <ids> --scenarios <ids> [options]

Options:
  --models <id,...>          Explicit model IDs; repeatable and required
  --scenarios <id,...>       Scenario IDs; repeatable and required
  --attempts <1-50>          Attempts per model and scenario (default: 1)
  --through <scaffold|local> Evaluation endpoint (default: scaffold)
  --concurrency <1-10>       Maximum concurrent evaluator processes (default: 1)
  --seed <value>             Deterministic schedule seed
  --output <directory>       Matrix output directory
  --dry-run                  Write the deterministic manifest without model calls
  -h, --help                 Show this help
`;

if (require.main === module) {
    void main().catch(error => {
        console.error(getErrorMessage(error));
        process.exitCode = 1;
    });
}
