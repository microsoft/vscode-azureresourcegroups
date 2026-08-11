/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/naming-convention -- Vally configs and evidence use stable snake_case wire keys. */

import type {
    GraderComparisonResult,
    GraderResult,
    LlmClient,
    Trajectory,
} from '@microsoft/vally';
import {
    PanelGrader,
    PromptGrader,
    createCopilotLlmClient,
} from '@microsoft/vally';
import { promises as fs } from 'fs';
import * as path from 'path';
import { loadScenarios } from './scenario';
import type { CorEvaluationScenario } from './scenario';
import {
    canUseTranscriptForQualitativeGrading,
    type AdapterTrajectory,
    type CustomMetricsDocument,
    type TranscriptFidelity,
} from './vally';

const evidencePacketSource = 'copilot-on-rails-evaluator-evidence-packet';
const maxArtifactExcerptChars = 6_000;
const maxRunEvidenceChars = 18_000;
const maxWorkspaceFiles = 300;

interface SatisfactionOptions {
    inputDirectory: string;
    outputDirectory: string;
    judgeModels: string[];
    reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh';
    mode: 'individual' | 'compare' | 'all';
}

interface LoadedAttempt {
    arm: 'rails' | 'baseline-controlled';
    trajectory: AdapterTrajectory;
    hardGate: GraderResult;
    metrics: CustomMetricsDocument;
    scenario: CorEvaluationScenario;
}

interface SatisfactionTrajectory extends Trajectory {
    metadata: Trajectory['metadata'] & {
        source: string;
        evidenceFidelity: 'captured-sdk-events' | 'evaluator-grounded-artifacts';
        transcriptFidelity: TranscriptFidelity;
        sourceArtifactDir: string;
        endpoint: string;
        scenarioId: string;
        attempt: number;
        sessionID: string;
    };
}

export interface SatisfactionAttemptResult {
    arm: LoadedAttempt['arm'];
    model: string;
    scenarioId: string;
    attempt: number;
    endpoint: string;
    runId: string;
    hardGatePassed: boolean;
    judge: GraderResult;
    effectivePassed: boolean;
    effectiveScore: number;
}

export interface SatisfactionComparisonResult {
    model: string;
    scenarioId: string;
    attempt: number;
    endpoint: string;
    baselineRunId: string;
    treatmentRunId: string;
    bothHardGatesPassed: boolean;
    judge: GraderComparisonResult;
}

export interface SatisfactionReport {
    schemaVersion: '1';
    source: typeof evidencePacketSource;
    generatedAt: string;
    judgeModels: string[];
    reasoningEffort: SatisfactionOptions['reasoningEffort'];
    attempts: SatisfactionAttemptResult[];
    comparisons: SatisfactionComparisonResult[];
    caveats: string[];
}

interface ArtifactExcerpt {
    present: boolean;
    relativePath: string;
    excerpt?: string;
}

export interface SatisfactionEvidencePacket {
    schemaVersion: '1';
    source: typeof evidencePacketSource;
    provenance: {
        transcriptFidelity: 'summary-only';
        evidenceFidelity: 'evaluator-grounded-artifacts';
        sourceArtifactDir: string;
        generatedSourceCodeIncluded: false;
    };
    scope: {
        arm: LoadedAttempt['arm'];
        model: string;
        scenarioId: string;
        attempt: number;
        endpoint: string;
        tags: Record<string, string>;
        rubric: string[];
    };
    hardGates: CustomMetricsDocument;
    runEvidence: unknown;
    artifacts: ArtifactExcerpt[];
    workspaceFiles: string[];
}

export async function runSatisfactionEvaluation(
    options: SatisfactionOptions,
    client?: LlmClient,
): Promise<SatisfactionReport> {
    const scenarios = await loadScenarios(path.resolve('evals', 'scenarios'));
    const scenarioById = new Map(scenarios.map(scenario => [scenario.id, scenario]));
    const attempts = await loadAttempts(path.resolve(options.inputDirectory), scenarioById);
    const ownedClient = client ?? await createCopilotLlmClient();
    try {
        const judgedAttempts = options.mode === 'compare'
            ? []
            : await gradeAttempts(attempts, options, ownedClient);
        const comparisons = options.mode === 'individual'
            ? []
            : await compareAttempts(attempts, options, ownedClient);
        const report: SatisfactionReport = {
            schemaVersion: '1',
            source: evidencePacketSource,
            generatedAt: new Date().toISOString(),
            judgeModels: options.judgeModels,
            reasoningEffort: options.reasoningEffort,
            attempts: judgedAttempts,
            comparisons,
            caveats: [
                'Executable ACA, browser, debugger, deployment, security, and cleanup gates remain authoritative.',
                'Full/mixed attempts use captured SDK events; summary-only attempts use evaluator-grounded summaries and selected generated artifacts. Hidden model reasoning is never included.',
                'An LLM satisfaction score is normalized to zero when the attempt fails an applicable hard gate.',
                'Paired qualitative comparisons are supplemental and are never used to excuse a hard-gate failure.',
                'Human calibration labels are still required before adopting the qualitative score as a release threshold.',
            ],
        };
        await fs.mkdir(options.outputDirectory, { recursive: true });
        await Promise.all([
            fs.writeFile(
                path.join(options.outputDirectory, 'satisfaction-report.json'),
                `${JSON.stringify(report, null, 2)}\n`,
            ),
            fs.writeFile(
                path.join(options.outputDirectory, 'satisfaction-report.md'),
                renderSatisfactionMarkdown(report),
            ),
        ]);
        return report;
    } finally {
        if (!client) {
            await ownedClient.shutdown();
        }
    }
}

async function gradeAttempts(
    attempts: LoadedAttempt[],
    options: SatisfactionOptions,
    client: LlmClient,
): Promise<SatisfactionAttemptResult[]> {
    const grader = options.judgeModels.length === 1 ? new PromptGrader(client) : new PanelGrader(client);
    const results: SatisfactionAttemptResult[] = [];
    for (const attempt of attempts) {
        const evidenceTrajectory = await createSatisfactionTrajectory(attempt);
        const config = options.judgeModels.length === 1
            ? {
                model: options.judgeModels[0],
                reasoning_effort: options.reasoningEffort,
                scoring: 'scale_1_5',
                threshold: 0.75,
                prompt: satisfactionJudgePrompt,
                evidence: ['trajectory'],
            }
            : {
                models: options.judgeModels.map(model => ({
                    model,
                    reasoning_effort: options.reasoningEffort,
                })),
                aggregation: 'median',
                scoring: 'scale_1_5',
                threshold: 0.75,
                prompt: satisfactionJudgePrompt,
                evidence: ['trajectory'],
            };
        const judge = await grader.grade({
            trajectory: evidenceTrajectory,
            stimulus: evidenceTrajectory.stimulus,
            config,
        });
        await writeAttemptEvidence(options.outputDirectory, evidenceTrajectory, judge);
        results.push({
            ...attemptIdentity(attempt),
            hardGatePassed: attempt.hardGate.passed,
            judge,
            effectivePassed: attempt.hardGate.passed && judge.passed,
            effectiveScore: attempt.hardGate.passed ? judge.score : 0,
        });
    }
    return results;
}

async function compareAttempts(
    attempts: LoadedAttempt[],
    options: SatisfactionOptions,
    client: LlmClient,
): Promise<SatisfactionComparisonResult[]> {
    if (options.judgeModels.length !== 1) {
        throw new Error('Position-swapped Vally comparison requires exactly one judge model.');
    }
    const grader = new PromptGrader(client);
    const treatment = new Map(
        attempts
            .filter(attempt => attempt.arm === 'rails')
            .map(attempt => [pairingKey(attempt), attempt]),
    );
    const baseline = new Map(
        attempts
            .filter(attempt => attempt.arm === 'baseline-controlled')
            .map(attempt => [pairingKey(attempt), attempt]),
    );
    const results: SatisfactionComparisonResult[] = [];
    for (const [key, treatmentAttempt] of treatment) {
        const baselineAttempt = baseline.get(key);
        if (!baselineAttempt) {
            continue;
        }
        assertSameModelPair(treatmentAttempt, baselineAttempt);
        const [treatmentTrajectory, baselineTrajectory] = await Promise.all([
            createSatisfactionTrajectory(treatmentAttempt),
            createSatisfactionTrajectory(baselineAttempt),
        ]);
        const judge = await grader.compare({
            comparison: {
                topology: 'baseline-relative',
                baseline: { label: 'baseline-controlled', trajectory: baselineTrajectory },
                treatment: { label: 'rails', trajectory: treatmentTrajectory },
            },
            stimulus: treatmentTrajectory.stimulus,
            config: {
                model: options.judgeModels[0],
                reasoning_effort: options.reasoningEffort,
                prompt: satisfactionComparisonPrompt,
            },
        });
        await Promise.all([
            writeAttemptEvidence(options.outputDirectory, treatmentTrajectory),
            writeAttemptEvidence(options.outputDirectory, baselineTrajectory),
        ]);
        results.push({
            model: String(treatmentAttempt.trajectory.metadata.model),
            scenarioId: String(treatmentAttempt.trajectory.metadata.scenarioId),
            attempt: Number(treatmentAttempt.trajectory.metadata.attempt),
            endpoint: String(treatmentAttempt.trajectory.metadata.endpoint),
            baselineRunId: String(baselineAttempt.trajectory.metadata.sessionID),
            treatmentRunId: String(treatmentAttempt.trajectory.metadata.sessionID),
            bothHardGatesPassed: treatmentAttempt.hardGate.passed && baselineAttempt.hardGate.passed,
            judge,
        });
    }
    return results;
}

export async function createSatisfactionTrajectory(attempt: LoadedAttempt): Promise<SatisfactionTrajectory> {
    const fidelity = attempt.trajectory.metadata.transcriptFidelity;
    if (canUseTranscriptForQualitativeGrading(fidelity)) {
        return {
            ...attempt.trajectory,
            id: `${attempt.trajectory.id}:satisfaction`,
            stimulus: {
                ...attempt.trajectory.stimulus,
                rubric: createSatisfactionRubric(
                    attempt.scenario,
                    String(attempt.trajectory.metadata.endpoint),
                ),
            },
            metadata: {
                ...attempt.trajectory.metadata,
                evidenceFidelity: 'captured-sdk-events',
            },
        };
    }
    const packet = await createSatisfactionEvidencePacket(attempt);
    const timestamp = new Date();
    const events = [
        ...attempt.trajectory.events,
        {
            type: 'custom' as const,
            timestamp,
            turn: 0,
            data: {
                eventType: 'satisfaction_evidence_packet',
                source: evidencePacketSource,
                generatedSourceCodeIncluded: false,
            },
        },
    ];
    return {
        ...attempt.trajectory,
        id: `${attempt.trajectory.id}:satisfaction`,
        stimulus: {
            ...attempt.trajectory.stimulus,
            rubric: packet.scope.rubric,
        },
        events,
        output: JSON.stringify(packet, null, 2),
        metadata: {
            ...attempt.trajectory.metadata,
            source: evidencePacketSource,
            evidenceFidelity: 'evaluator-grounded-artifacts',
            transcriptFidelity: 'summary-only',
        },
    };
}

export async function createSatisfactionEvidencePacket(
    attempt: LoadedAttempt,
): Promise<SatisfactionEvidencePacket> {
    const sourceArtifactDir = sourceArtifactDirectory(attempt.trajectory);
    const rubric = createSatisfactionRubric(
        attempt.scenario,
        String(attempt.trajectory.metadata.endpoint),
    );
    const [runEvidence, artifacts, workspaceFiles] = await Promise.all([
        readJsonEvidence(path.join(sourceArtifactDir, 'run-result.json')),
        Promise.all([
            readArtifactExcerpt(sourceArtifactDir, '.azure/requirements.json'),
            readArtifactExcerpt(sourceArtifactDir, '.azure/project-plan.md'),
            readArtifactExcerpt(sourceArtifactDir, '.azure/vscode-debug-plan.md'),
            readArtifactExcerpt(sourceArtifactDir, '.azure/deployment-plan.md'),
            readArtifactExcerpt(sourceArtifactDir, 'workspace/README.md'),
        ]),
        listWorkspaceFiles(path.join(sourceArtifactDir, 'workspace')),
    ]);
    return {
        schemaVersion: '1',
        source: evidencePacketSource,
        provenance: {
            transcriptFidelity: 'summary-only',
            evidenceFidelity: 'evaluator-grounded-artifacts',
            sourceArtifactDir,
            generatedSourceCodeIncluded: false,
        },
        scope: {
            arm: attempt.arm,
            model: String(attempt.trajectory.metadata.model),
            scenarioId: String(attempt.trajectory.metadata.scenarioId),
            attempt: Number(attempt.trajectory.metadata.attempt),
            endpoint: String(attempt.trajectory.metadata.endpoint),
            tags: attempt.scenario.tags,
            rubric,
        },
        hardGates: attempt.metrics,
        runEvidence,
        artifacts,
        workspaceFiles,
    };
}

export function createSatisfactionRubric(
    scenario: CorEvaluationScenario,
    endpoint: string,
): string[] {
    const rubric = [
        'Requirements experience: the generated requirements are clear, internally consistent, and traceable to the requested project.',
        'Planning experience: the project plan is technically appropriate, understandable, and covers the requested services and user workflows.',
    ];
    if (endpointRank(endpoint) >= endpointRank('scaffold')) {
        rubric.push(
            'Implementation quality: the generated repository structure, dependency choices, tests, and documentation appear maintainable and appropriate for the scenario.',
        );
    }
    if (endpointRank(endpoint) >= endpointRank('local')) {
        rubric.push(
            'Local developer experience: setup, startup, VS Code tasks, and debugging evidence support a user reaching a working local project without hidden manual repair.',
            'Functional satisfaction: independent runtime evidence demonstrates the requested user or worker journey rather than only a process starting.',
        );
        if (scenario.acceptance?.local?.probes.some(probe => probe.browser)) {
            rubric.push(
                'Frontend satisfaction: the browser journey is coherent, accessible, free of serious console/runtime errors, and completes the scenario actions and assertions.',
            );
        }
        if (scenario.acceptance?.local?.probes.some(probe => probe.browser?.persistence)
            || scenario.acceptance?.local?.storageEvents?.length) {
            rubric.push(
                'Reliability and durability: evaluator-owned restart or storage-event evidence proves persisted state or durable worker side effects.',
            );
        }
    }
    if (endpointRank(endpoint) >= endpointRank('deploy')) {
        rubric.push(
            'Deployment experience: deployment artifacts and independent deployed checks provide a clear, secure, repeatable path to an actually usable Azure deployment.',
        );
    }
    return rubric;
}

export function assertSameModelPair(treatment: LoadedAttempt, baseline: LoadedAttempt): void {
    const fields = ['model', 'scenarioId', 'attempt', 'endpoint'] as const;
    for (const field of fields) {
        const left = treatment.trajectory.metadata[field];
        const right = baseline.trajectory.metadata[field];
        if (left !== right) {
            throw new Error(
                `Qualitative comparison pair mismatch for ${field}: ${String(left)} !== ${String(right)}.`,
            );
        }
    }
}

async function loadAttempts(
    inputDirectory: string,
    scenarioById: ReadonlyMap<string, CorEvaluationScenario>,
): Promise<LoadedAttempt[]> {
    const attempts: LoadedAttempt[] = [];
    for (const armDirectory of ['treatment', 'baseline'] as const) {
        const root = path.join(inputDirectory, armDirectory, 'attempts');
        let names: string[];
        try {
            names = await fs.readdir(root);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                continue;
            }
            throw error;
        }
        for (const name of names.sort()) {
            const directory = path.join(root, name);
            const [trajectoryRaw, metrics, gradeDocument] = await Promise.all([
                readRequiredJson<AdapterTrajectory>(path.join(directory, 'trajectory.json')),
                readRequiredJson<CustomMetricsDocument>(path.join(directory, 'custom_metrics.json')),
                readRequiredJson<{ effectiveGrade: GraderResult }>(path.join(directory, 'grade.json')),
            ]);
            const trajectory = rehydrateTrajectory(trajectoryRaw);
            if (trajectory.metadata.source !== 'copilot-on-rails-summary-adapter') {
                throw new Error(`Unsupported trajectory source in ${directory}.`);
            }
            const scenarioId = String(trajectory.metadata.scenarioId);
            const scenario = scenarioById.get(scenarioId);
            if (!scenario) {
                throw new Error(`Unknown scenario "${scenarioId}" in ${directory}.`);
            }
            attempts.push({
                arm: armDirectory === 'treatment' ? 'rails' : 'baseline-controlled',
                trajectory,
                hardGate: gradeDocument.effectiveGrade,
                metrics,
                scenario,
            });
        }
    }
    return attempts.sort((left, right) => pairingKey(left).localeCompare(pairingKey(right))
        || left.arm.localeCompare(right.arm));
}

function rehydrateTrajectory(trajectory: AdapterTrajectory): AdapterTrajectory {
    return {
        ...trajectory,
        events: trajectory.events.map(event => ({
            ...event,
            ...(event.timestamp ? { timestamp: new Date(event.timestamp) } : {}),
        })),
        metadata: {
            ...trajectory.metadata,
            ...(trajectory.metadata.startedAt
                ? { startedAt: new Date(trajectory.metadata.startedAt) }
                : {}),
            ...(trajectory.metadata.completedAt
                ? { completedAt: new Date(trajectory.metadata.completedAt) }
                : {}),
        },
    };
}

function sourceArtifactDirectory(trajectory: AdapterTrajectory): string {
    const value = trajectory.metadata.sourceArtifactDir;
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
        throw new Error(`Trajectory ${trajectory.id} is missing an absolute sourceArtifactDir.`);
    }
    return value;
}

async function readArtifactExcerpt(root: string, relativePath: string): Promise<ArtifactExcerpt> {
    try {
        const content = await fs.readFile(path.join(root, relativePath), 'utf8');
        return {
            present: true,
            relativePath,
            excerpt: redactAndTruncate(content, maxArtifactExcerptChars),
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { present: false, relativePath };
        }
        throw error;
    }
}

async function readJsonEvidence(filePath: string): Promise<unknown> {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        const redacted = redactAndTruncate(content, Number.MAX_SAFE_INTEGER);
        const parsed = JSON.parse(redacted) as unknown;
        const serialized = JSON.stringify(parsed);
        return serialized.length <= maxRunEvidenceChars
            ? parsed
            : {
                available: true,
                truncated: true,
                excerpt: redactAndTruncate(serialized, maxRunEvidenceChars),
            };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { available: false, reason: 'run-result.json is missing' };
        }
        if (error instanceof SyntaxError) {
            return {
                available: false,
                reason: 'run-result.json was invalid JSON',
            };
        }
        throw error;
    }
}

async function listWorkspaceFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const excluded = new Set([
        '.git',
        '.venv',
        'bin',
        'build',
        'coverage',
        'dist',
        'node_modules',
        'obj',
    ]);
    async function visit(directory: string): Promise<void> {
        if (files.length >= maxWorkspaceFiles) {
            return;
        }
        let entries: import('fs').Dirent[];
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return;
            }
            throw error;
        }
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            if (files.length >= maxWorkspaceFiles || excluded.has(entry.name)) {
                continue;
            }
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(absolute);
            } else if (entry.isFile()) {
                files.push(path.relative(root, absolute));
            }
        }
    }
    await visit(root);
    return files;
}

function redactAndTruncate(content: string, limit: number): string {
    const redacted = content
        .replace(
            /("(?:password|secret|token|connectionString|connection_string|apiKey|api_key)"\s*:\s*)"[^"]*"/gi,
            '$1"[REDACTED]"',
        )
        .replace(
            /((?:password|secret|token|connectionString|connection_string|apiKey|api_key)\s*[=:]\s*)[^\s"'`]+/gi,
            '$1[REDACTED]',
        );
    return redacted.length <= limit
        ? redacted
        : `${redacted.slice(0, limit)}\n...[truncated ${redacted.length - limit} characters]`;
}

async function readRequiredJson<T>(filePath: string): Promise<T> {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

async function writeAttemptEvidence(
    outputDirectory: string,
    trajectory: SatisfactionTrajectory,
    judge?: GraderResult,
): Promise<void> {
    const runId = path.basename(String(trajectory.metadata.sessionID)).replace(/[^A-Za-z0-9._-]/g, '-');
    const directory = path.join(outputDirectory, 'attempts', runId);
    await fs.mkdir(directory, { recursive: true });
    await Promise.all([
        fs.writeFile(path.join(directory, 'evidence.json'), `${trajectory.output}\n`),
        fs.writeFile(path.join(directory, 'trajectory.json'), `${JSON.stringify(trajectory, null, 2)}\n`),
        ...(judge
            ? [fs.writeFile(path.join(directory, 'judge.json'), `${JSON.stringify(judge, null, 2)}\n`)]
            : []),
    ]);
}

function pairingKey(attempt: LoadedAttempt): string {
    return [
        String(attempt.trajectory.metadata.model),
        String(attempt.trajectory.metadata.scenarioId),
        String(attempt.trajectory.metadata.attempt),
        String(attempt.trajectory.metadata.endpoint),
    ].join('\0');
}

function attemptIdentity(attempt: LoadedAttempt): Omit<
    SatisfactionAttemptResult,
    'hardGatePassed' | 'judge' | 'effectivePassed' | 'effectiveScore'
> {
    return {
        arm: attempt.arm,
        model: String(attempt.trajectory.metadata.model),
        scenarioId: String(attempt.trajectory.metadata.scenarioId),
        attempt: Number(attempt.trajectory.metadata.attempt),
        endpoint: String(attempt.trajectory.metadata.endpoint),
        runId: String(attempt.trajectory.metadata.sessionID),
    };
}

function endpointRank(endpoint: string): number {
    const ranks: Record<string, number> = {
        requirements: 0,
        plan: 1,
        scaffold: 2,
        local: 3,
        deploy: 4,
    };
    return ranks[endpoint] ?? -1;
}

function renderSatisfactionMarkdown(report: SatisfactionReport): string {
    const lines = [
        '# Copilot on Rails qualitative satisfaction report',
        '',
        `Generated: ${report.generatedAt}`,
        `Judge model(s): ${report.judgeModels.join(', ')}`,
        `Reasoning effort: ${report.reasoningEffort}`,
        '',
        '## Attempt scores',
        '',
        '| Arm | Model | Scenario | Attempt | Endpoint | Hard gates | Judge | Effective |',
        '| --- | --- | --- | ---: | --- | --- | ---: | ---: |',
        ...report.attempts.map(attempt =>
            `| ${attempt.arm} | ${attempt.model} | ${attempt.scenarioId} | ${attempt.attempt} | ${attempt.endpoint} | ${attempt.hardGatePassed ? 'pass' : 'fail'} | ${attempt.judge.score.toFixed(3)} | ${attempt.effectiveScore.toFixed(3)} |`),
        '',
        '## Paired qualitative comparisons',
        '',
        '| Model | Scenario | Attempt | Endpoint | Both hard gates pass | Winner | Magnitude | Score |',
        '| --- | --- | ---: | --- | --- | --- | --- | ---: |',
        ...report.comparisons.map(comparison =>
            `| ${comparison.model} | ${comparison.scenarioId} | ${comparison.attempt} | ${comparison.endpoint} | ${comparison.bothHardGatesPassed ? 'yes' : 'no'} | ${comparison.judge.winner} | ${comparison.judge.magnitude} | ${comparison.judge.score.toFixed(3)} |`),
        '',
        '## Caveats',
        '',
        ...report.caveats.map(caveat => `- ${caveat}`),
        '',
    ];
    return lines.join('\n');
}

const satisfactionJudgePrompt = [
    'Judge likely user satisfaction at each applicable Copilot on Rails step.',
    'Use only the evaluator evidence packet in Agent Output.',
    'Do not infer that a missing artifact, omitted runtime check, or unobserved behavior passed.',
    'The packet does not contain generated source code or hidden reasoning; do not claim to have inspected either.',
    'Executable hard gates are authoritative. Explain qualitative usability, clarity, completeness, and coherence without overriding them.',
].join(' ');

const satisfactionComparisonPrompt = [
    'Compare likely user satisfaction for the two evaluator evidence packets.',
    'Use only observed evidence and apply the rubric criterion by criterion.',
    'Do not reward verbosity, token use, or the Copilot on Rails label.',
    'A hard-gate failure remains a failure; qualitative preference is supplemental.',
].join(' ');

function parseArgs(args: string[]): SatisfactionOptions | 'help' {
    const options: SatisfactionOptions = {
        inputDirectory: '',
        outputDirectory: 'evals/results/vally-satisfaction',
        judgeModels: [],
        reasoningEffort: 'medium',
        mode: 'individual',
    };
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        const value = args[index + 1];
        switch (argument) {
            case '--help':
                return 'help';
            case '--input':
                options.inputDirectory = requireValue(argument, value);
                index++;
                break;
            case '--output':
                options.outputDirectory = requireValue(argument, value);
                index++;
                break;
            case '--judge-models':
                options.judgeModels = requireValue(argument, value).split(',').map(model => model.trim()).filter(Boolean);
                index++;
                break;
            case '--reasoning-effort':
                if (!['low', 'medium', 'high', 'xhigh'].includes(value)) {
                    throw new Error('--reasoning-effort must be low, medium, high, or xhigh.');
                }
                options.reasoningEffort = value as SatisfactionOptions['reasoningEffort'];
                index++;
                break;
            case '--mode':
                if (!['individual', 'compare', 'all'].includes(value)) {
                    throw new Error('--mode must be individual, compare, or all.');
                }
                options.mode = value as SatisfactionOptions['mode'];
                index++;
                break;
            default:
                throw new Error(`Unknown argument: ${argument}`);
        }
    }
    if (!options.inputDirectory) {
        throw new Error('--input is required.');
    }
    if (options.judgeModels.length === 0) {
        throw new Error('--judge-models requires at least one explicit judge model.');
    }
    if (options.mode !== 'individual' && options.judgeModels.length !== 1) {
        throw new Error('Comparison mode requires exactly one judge model.');
    }
    return options;
}

function requireValue(argument: string, value: string | undefined): string {
    if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
    }
    return value;
}

function printHelp(): void {
    process.stdout.write([
        'Usage: npm run eval:cor:satisfaction -- --input <vally-output> --judge-models <model[,model]>',
        '',
        'Options:',
        '  --output <dir>              Report directory (default: evals/results/vally-satisfaction)',
        '  --reasoning-effort <level>  low, medium, high, or xhigh (default: medium)',
        '  --mode <mode>               individual, compare, or all (default: individual)',
        '',
    ].join('\n'));
}

if (require.main === module) {
    Promise.resolve()
        .then(() => parseArgs(process.argv.slice(2)))
        .then(async options => {
            if (options === 'help') {
                printHelp();
                return;
            }
            const report = await runSatisfactionEvaluation(options);
            process.stdout.write(`Qualitative satisfaction report: ${path.resolve(options.outputDirectory)}\n`);
            if (report.attempts.some(attempt => !attempt.effectivePassed)) {
                process.exitCode = 1;
            }
        })
        .catch(error => {
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
        });
}
