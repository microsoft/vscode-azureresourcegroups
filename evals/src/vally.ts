/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/naming-convention -- Custom metric names are stable JSON wire keys. */

import {
    computeMetrics,
    computeSkillScore,
    computeStimulusScore,
    gradeTrajectory,
    passAtK,
    passToTheK,
    type GraderResult,
    type StimulusGraderConfig,
    type Trajectory,
    type TrajectoryEvent,
    type TrialResultRecord,
} from '@microsoft/vally';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
    EvaluationDefinitionProvenance,
    isEvaluationDefinitionProvenance,
    sameEvaluationDefinition,
} from './evaluationDefinition';
import {
    EvaluationReport,
    EvaluationSummary,
    ReleaseGateResult,
    createReport,
    loadDeploymentResults,
    loadVsCodeParityResults,
} from './report';
import {
    defaultReleaseThresholdsPath,
    loadReleaseThresholds,
} from './releaseThresholds';
import { SandboxVsCodeParityResult } from './SandboxVsCodeParityValidator';
import { LiveDeploymentResult } from './liveDeploy';
import { CorEvaluationScenario, loadScenarios } from './scenario';
import type {
    CorAgentTimelineEvent,
} from '../../src/utils/copilotOnRails/agentExecution/CorAgentExecutor';

export const adapterSource = 'copilot-on-rails-summary-adapter';
export const transcriptFidelity = 'summary-only';
export type TranscriptFidelity = 'full' | 'mixed' | typeof transcriptFidelity;
type TokenUsageFidelity = 'event-timeline' | 'mixed' | 'stage-summary';
const metricsSchema = 'copilot-on-rails-vally-custom-metrics/v1';
const regradeEvalFilePath = 'regrade-eval.yaml';

type EvaluationArm = 'rails' | 'baseline-controlled';
type GateStatus = 'passed' | 'failed' | 'missing-evidence' | 'not-applicable';

export interface VallyAdapterOptions {
    inputs: string[];
    baselineInputs: string[];
    vscodeParityInputs: string[];
    deploymentInputs: string[];
    thresholdsPath: string;
    outputDirectory: string;
}

interface SourceProvenance {
    promptSource?: string;
    promptField?: string;
    agentIdentity?: string;
    workspaceSeed?: string;
    railsAssetsInjected?: boolean;
    customToolsInjected?: boolean;
}

interface UsageEvidence {
    apiCalls?: number;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    totalNanoAiu?: number;
    models?: string[];
}

interface SupplementalAttemptEvidence {
    vscodeParityOutcome?: 'passed' | 'failed';
    deploymentOutcome?: 'passed' | 'failed';
}

interface ToolCallEvidence {
    toolCallId?: string;
    toolName?: string;
    startedAt?: string;
    completedAt?: string;
    success?: boolean;
    error?: string;
}

interface AgentRunEvidence {
    outcome?: string;
    sessionId?: string;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    usage?: UsageEvidence;
    toolCalls?: ToolCallEvidence[];
    errors?: string[];
    finalMessage?: string;
    eventTimeline?: CorAgentTimelineEvent[];
}

interface BrowserEvidence {
    name?: string;
    success?: boolean;
    seriousAccessibilityViolations?: string[];
    accessibilityScanned?: boolean;
    accessibilityScanError?: string;
    consoleErrors?: string[];
    actionsCompleted?: number;
    actionsExpected?: number;
    assertionsCompleted?: number;
    assertionsExpected?: number;
}

interface SuccessEvidence {
    name?: string;
    success?: boolean;
}

interface CommandEvidence {
    kind?: string;
    name?: string;
    command?: string;
    ecosystem?: string;
    relativeDirectory?: string;
    cwd?: string;
    success?: boolean;
    stdout?: string;
    stderr?: string;
}

interface ProjectValidationEvidence {
    outcome?: string;
    failureCode?: string;
    error?: string;
    commands?: CommandEvidence[];
}

interface LocalRuntimeEvidence {
    outcome?: string;
    failureCode?: string;
    error?: string;
    commands?: CommandEvidence[];
    browserChecks?: BrowserEvidence[];
    persistenceChecks?: SuccessEvidence[];
    workerEvents?: SuccessEvidence[];
}

interface StageEvidence {
    name?: string;
    gateCalled?: boolean;
    agentRun?: AgentRunEvidence;
    validation?: { valid?: boolean };
    buildValidation?: ProjectValidationEvidence;
    localRuntimeValidation?: LocalRuntimeEvidence;
    deploymentValidation?: { outcome?: string };
}

export interface AttemptEvidence {
    schemaVersion?: string;
    evaluationArm?: EvaluationArm;
    runId: string;
    scenarioId: string;
    attempt: number;
    outcome: 'autonomous_success' | 'failed';
    failedStage?: string;
    failureCode?: string;
    failureCategory?: 'product_failure' | 'harness_failure' | 'infrastructure_failure';
    error?: string;
    qualityFailures?: {
        stage?: string;
        code?: string;
        category?: 'product_failure';
        error?: string;
    }[];
    candidateCommit?: string;
    agentAssetsHash?: string;
    evaluationDefinition?: EvaluationDefinitionProvenance;
    model?: string;
    requestedModel?: string;
    observedModels?: string[];
    durationMs: number;
    agentRetries?: number;
    stages: StageEvidence[];
    sourceProvenance?: SourceProvenance;
    deploymentValidation?: { outcome?: string };
}

export interface SummaryEvidence {
    schemaVersion: string;
    evaluationArm: EvaluationArm;
    startedAt?: string;
    completedAt?: string;
    candidateCommit: string;
    agentAssetsHash: string;
    evaluationDefinitions?: EvaluationDefinitionProvenance[];
    through: string;
    requestedModel?: string;
    requestedModels?: string[];
    observedModels?: string[];
    sourceProvenance?: SourceProvenance;
    results: AttemptEvidence[];
}

export interface LoadedSummary {
    summary: SummaryEvidence;
    summaryPath: string;
}

export interface CustomMetricsDocument {
    schema: typeof metricsSchema;
    source: typeof adapterSource;
    transcriptFidelity: TranscriptFidelity;
    values: {
        autonomous_success: boolean;
        final_product_success: boolean;
        first_pass_success: boolean;
        product_quality_included: boolean;
        product_quality_success: boolean | null;
        repair_count: number;
        stage_depth: number;
        duration_ms: number;
        input_tokens: number;
        output_tokens: number;
        reasoning_tokens: number;
        cache_read_tokens: number;
        total_tokens: number;
        total_nano_aiu: number;
        browser_functional_applicable: boolean;
        browser_functional_status: GateStatus;
        browser_functional_success: boolean | null;
        browser_check_count: number | null;
        accessibility_applicable: boolean;
        accessibility_status: GateStatus;
        accessibility_success: boolean | null;
        accessibility_scan_count: number | null;
        accessibility_finding_count: number | null;
        persistence_applicable: boolean;
        persistence_status: GateStatus;
        persistence_success: boolean | null;
        persistence_check_count: number | null;
        worker_event_applicable: boolean;
        worker_event_status: GateStatus;
        worker_event_success: boolean | null;
        worker_event_check_count: number | null;
        debugger_evidence_applicable: boolean;
        debugger_evidence_status: GateStatus;
        debugger_evidence_success: boolean | null;
        debugger_check_count: number | null;
        deployment_evidence_present: boolean;
        deployment_status: GateStatus;
        deployment_success: boolean | null;
        authoritative_hard_gates_passed: boolean;
    };
}

export interface AdapterTrajectory extends Trajectory {
    metadata: Trajectory['metadata'] & {
        source: typeof adapterSource;
        transcriptFidelity: TranscriptFidelity;
        tokenUsageFidelity: TokenUsageFidelity;
        outputProvenance?: 'captured-assistant-message' | 'not-observed';
        outputOmissionReason?: string;
        summaryPath: string;
        sourceArtifactDir: string;
        evaluationArm: EvaluationArm;
        endpoint: string;
        scenarioId: string;
        attempt: number;
        evaluationDefinitionHash?: string;
    };
}

export interface ConvertedAttempt {
    arm: EvaluationArm;
    endpoint: string;
    model: string;
    scenarioId: string;
    attempt: number;
    runId: string;
    summaryPath: string;
    trajectory: AdapterTrajectory;
    customMetrics: CustomMetricsDocument;
    graderConfigs: StimulusGraderConfig[];
    grade: GraderResult;
    effectiveGrade: GraderResult;
    evaluationDefinition?: EvaluationDefinitionProvenance;
}

export interface VallyGroupReport {
    arm: EvaluationArm;
    model: string;
    scenarioId: string;
    endpoint: string;
    trials: number;
    successes: number;
    passRate: number;
    passAtK: Record<string, number>;
    passToTheK: Record<string, number>;
    flaky: boolean;
    flakinessPercent: number;
    aggregateScore: number;
    vallyStimulusScore: ReturnType<typeof computeStimulusScore>;
    vallySkillScore: ReturnType<typeof computeSkillScore>;
}

export interface PairingManifest {
    schemaVersion: '1';
    source: typeof adapterSource;
    matchingKey: 'model+scenarioId+attempt+endpoint';
    qualitativeComparison: {
        performed: false;
        reason: string;
    };
    pairs: {
        key: string;
        model: string;
        scenarioId: string;
        attempt: number;
        endpoint: string;
        treatmentTrajectoryId: string;
        baselineTrajectoryId: string;
    }[];
    unmatchedTreatment: string[];
    unmatchedBaseline: string[];
}

export interface VallyAdapterReport {
    schemaVersion: '1';
    source: typeof adapterSource;
    transcriptFidelity: TranscriptFidelity;
    tokenUsageFidelity: TokenUsageFidelity;
    generatedAt: string;
    groups: VallyGroupReport[];
    pairing: PairingManifest;
    experiments: VallyModelExperiment[];
    releaseAssessment: EvaluationReport['releaseAssessment'];
    releaseGates: NonNullable<EvaluationReport['releaseGates']>;
    records: {
        treatment: string;
        baseline: string | null;
        regradeSpec: string;
        authoritativeEvidence: string;
    };
}

export interface VallyModelExperiment {
    model: string;
    treatmentTrials: number;
    baselineTrials: number;
    exactPairs: number;
    unmatchedTreatment: number;
    unmatchedBaseline: number;
    treatmentPassRate: number | null;
    baselinePassRate: number | null;
    passRateDelta: number | null;
    treatmentAggregateScore: number | null;
    baselineAggregateScore: number | null;
}

export async function runVallyAdapter(options: VallyAdapterOptions): Promise<VallyAdapterReport> {
    const repoRoot = process.cwd();
    const scenarios = await loadScenarios(path.join(repoRoot, 'evals', 'scenarios'));
    const scenarioById = new Map(scenarios.map(scenario => [scenario.id, scenario]));
    const seenRunIds = new Set<string>();
    const treatmentSummaries = await loadAndValidateSummaries(
        options.inputs,
        'rails',
        scenarioById,
        seenRunIds,
    );
    const baselineSummaries = await loadAndValidateSummaries(
        options.baselineInputs,
        'baseline-controlled',
        scenarioById,
        seenRunIds,
    );
    const outputDirectory = path.resolve(options.outputDirectory);
    await fs.mkdir(outputDirectory, { recursive: true });
    const [vscodeParityResults, deploymentResults] = await Promise.all([
        loadVsCodeParityResults(options.vscodeParityInputs),
        loadDeploymentResults(options.deploymentInputs),
    ]);
    const supplementalEvidence = createSupplementalEvidence(
        vscodeParityResults,
        deploymentResults,
    );

    const treatment = await convertSummaries(
        treatmentSummaries,
        scenarioById,
        path.join(outputDirectory, 'treatment'),
        supplementalEvidence,
    );
    const baseline = await convertSummaries(
        baselineSummaries,
        scenarioById,
        path.join(outputDirectory, 'baseline'),
        supplementalEvidence,
    );
    const pairing = createPairingManifest(treatment, baseline);
    const groups = createGroupReports([...treatment, ...baseline]);
    const experiments = createModelExperiments(treatment, baseline);
    const nativeEvidence = createReport(
        treatmentSummaries.map(value => value.summary as unknown as EvaluationSummary),
        scenarios,
        baselineSummaries.map(value => value.summary as unknown as EvaluationSummary),
        vscodeParityResults,
        deploymentResults,
        loadReleaseThresholds(options.thresholdsPath),
    );

    await writeRecords(path.join(outputDirectory, 'treatment'), treatment);
    if (baseline.length > 0) {
        await writeRecords(path.join(outputDirectory, 'baseline'), baseline);
    }
    await writeJson(path.join(outputDirectory, 'comparison-manifest.json'), pairing);
    await writeJson(path.join(outputDirectory, 'authoritative-evidence.json'), nativeEvidence);
    await writeJson(
        path.join(outputDirectory, regradeEvalFilePath),
        createRegradeSpec([...treatment, ...baseline]),
    );

    const reportFidelity = classifyTrajectoryCollection([...treatment, ...baseline]);
    const report: VallyAdapterReport = {
        schemaVersion: '1',
        source: adapterSource,
        transcriptFidelity: reportFidelity,
        tokenUsageFidelity: tokenUsageFidelity(reportFidelity),
        generatedAt: new Date().toISOString(),
        groups,
        pairing,
        experiments,
        releaseAssessment: nativeEvidence.releaseAssessment,
        releaseGates: nativeEvidence.releaseGates as NonNullable<EvaluationReport['releaseGates']>,
        records: {
            treatment: 'treatment/results.jsonl',
            baseline: baseline.length > 0 ? 'baseline/results.jsonl' : null,
            regradeSpec: regradeEvalFilePath,
            authoritativeEvidence: 'authoritative-evidence.json',
        },
    };
    await writeJson(path.join(outputDirectory, 'report.json'), report);
    await fs.writeFile(path.join(outputDirectory, 'report.md'), renderMarkdown(report));
    process.stdout.write(`Vally offline report: ${path.join(outputDirectory, 'report.json')}\n`);
    return report;
}

function createSupplementalEvidence(
    vscodeParityResults: SandboxVsCodeParityResult[],
    deploymentResults: LiveDeploymentResult[],
): Map<string, SupplementalAttemptEvidence> {
    const result = new Map<string, SupplementalAttemptEvidence>();
    for (const parity of vscodeParityResults) {
        const runId = parity.sourceProvenance?.runId;
        if (!runId || parity.outcome === 'skipped') {
            continue;
        }
        const current = result.get(runId) ?? {};
        if (current.vscodeParityOutcome !== undefined) {
            throw new Error(`Multiple VS Code parity results target source run "${runId}".`);
        }
        result.set(runId, { ...current, vscodeParityOutcome: parity.outcome });
    }
    for (const deployment of deploymentResults) {
        const runId = deployment.sourceProvenance?.runId;
        if (!runId) {
            continue;
        }
        const current = result.get(runId) ?? {};
        if (current.deploymentOutcome !== undefined) {
            throw new Error(`Multiple deployment results target source run "${runId}".`);
        }
        result.set(runId, {
            ...current,
            deploymentOutcome: deployment.outcome === 'passed' && deployment.cleanupVerified
                ? 'passed'
                : 'failed',
        });
    }
    return result;
}

async function convertSummaries(
    loaded: LoadedSummary[],
    scenarioById: ReadonlyMap<string, CorEvaluationScenario>,
    armDirectory: string,
    supplementalEvidence: ReadonlyMap<string, SupplementalAttemptEvidence>,
): Promise<ConvertedAttempt[]> {
    const converted: ConvertedAttempt[] = [];
    for (const source of loaded) {
        for (const attempt of source.summary.results) {
            const scenario = scenarioById.get(attempt.scenarioId) as CorEvaluationScenario;
            const artifactDirectory = path.join(armDirectory, 'attempts', sanitizePathSegment(attempt.runId));
            await fs.mkdir(artifactDirectory, { recursive: true });
            const item = await convertAttempt(
                source,
                attempt,
                scenario,
                artifactDirectory,
                supplementalEvidence.get(attempt.runId),
            );
            await Promise.all([
                writeJson(path.join(artifactDirectory, 'trajectory.json'), item.trajectory),
                writeJson(path.join(artifactDirectory, 'grade.json'), {
                    grade: item.grade,
                    effectiveGrade: item.effectiveGrade,
                    graders: item.graderConfigs,
                }),
            ]);
            converted.push(item);
        }
    }
    return converted.sort(compareConvertedAttempts);
}

export async function convertAttempt(
    source: LoadedSummary,
    attempt: AttemptEvidence,
    scenario: CorEvaluationScenario,
    artifactDirectory: string,
    supplementalEvidence?: SupplementalAttemptEvidence,
): Promise<ConvertedAttempt> {
    await fs.mkdir(artifactDirectory, { recursive: true });
    const model = resolveAttemptModel(source.summary, attempt);
    const sourceArtifactDir = path.resolve(path.dirname(source.summaryPath), attempt.runId);
    const customMetrics = createCustomMetrics(
        source.summary,
        attempt,
        scenario,
        supplementalEvidence,
    );
    const graderConfigs = createHardGateGraders(customMetrics);
    const trajectory = createTrajectory(
        source,
        attempt,
        scenario,
        model,
        sourceArtifactDir,
        path.resolve(artifactDirectory),
    );
    await writeJson(path.join(artifactDirectory, 'custom_metrics.json'), customMetrics);
    const grade = await gradeTrajectory(trajectory, graderConfigs, { stimulus: trajectory.stimulus });
    const effectiveGrade: GraderResult = {
        ...grade,
        score: grade.passed ? grade.score : 0,
        metadata: {
            ...grade.metadata,
            hardGateNormalized: true,
            originalScore: grade.score,
        },
    };
    return {
        arm: source.summary.evaluationArm,
        endpoint: source.summary.through,
        model,
        scenarioId: attempt.scenarioId,
        attempt: attempt.attempt,
        runId: attempt.runId,
        summaryPath: source.summaryPath,
        trajectory,
        customMetrics,
        graderConfigs,
        grade,
        effectiveGrade,
        evaluationDefinition: attempt.evaluationDefinition,
    };
}

export function createTrajectory(
    source: LoadedSummary,
    attempt: AttemptEvidence,
    scenario: CorEvaluationScenario,
    model: string,
    sourceArtifactDir: string,
    artifactDirectory: string,
): AdapterTrajectory {
    const events: TrajectoryEvent[] = [];
    const fidelity = classifyTranscriptFidelity(attempt);
    const usageFidelity = tokenUsageFidelity(fidelity);
    const prompt = source.summary.evaluationArm === 'rails' ? scenario.prompt : scenario.baselinePrompt;
    const startedAt = earliestDate(attempt.stages.map(stage => stage.agentRun?.startedAt));
    const completedAt = latestDate(attempt.stages.map(stage => stage.agentRun?.completedAt));
    events.push({
        type: 'user_message',
        timestamp: startedAt,
        turn: 0,
        data: { content: prompt },
    });
    events.push({
        type: 'custom',
        timestamp: startedAt,
        turn: 0,
        data: {
            eventType: 'adapter_provenance',
            source: adapterSource,
            transcriptFidelity: fidelity,
            tokenUsageFidelity: usageFidelity,
            summaryPath: source.summaryPath,
            sourceArtifactDir,
            finalMessageOmitted: !hasCapturedAssistantMessage(attempt),
            finalMessageProvenance: hasCapturedAssistantMessage(attempt)
                ? 'captured-assistant-message'
                : 'not-observed',
            ...(!hasCapturedAssistantMessage(attempt)
                ? {
                    finalMessageOmissionReason: fidelity === transcriptFidelity
                        ? 'historical summary contains no captured SDK event timeline'
                        : 'captured SDK timelines contain no assistant.message event',
                }
                : {}),
            reasoningOmitted: true,
            reasoningOmissionReason: 'hidden reasoning is intentionally never captured',
        },
    });

    const turnState: CapturedTurnState = {
        next: 0,
        byIdentity: new Map<string, number>(),
        currentByAgent: new Map<string, number>(),
    };
    for (const [stageIndex, stage] of attempt.stages.entries()) {
        const stageName = stage.name ?? `stage-${stageIndex}`;
        const agentId = stage.agentRun
            ? `${stageName}:${stage.agentRun.sessionId ?? 'session-unknown'}`
            : undefined;
        events.push({
            type: 'custom',
            timestamp: validDate(stage.agentRun?.startedAt),
            turn: 0,
            agentId,
            data: {
                eventType: 'stage_summary',
                stageIndex,
                stageName: stage.name ?? 'unknown',
                gateCalled: stage.gateCalled ?? null,
                agentOutcome: stage.agentRun?.outcome ?? null,
                artifactValid: stage.validation?.valid ?? null,
                buildOutcome: stage.buildValidation?.outcome ?? null,
                localRuntimeOutcome: stage.localRuntimeValidation?.outcome ?? null,
            },
        });
        if (Array.isArray(stage.agentRun?.eventTimeline)) {
            appendCapturedAgentRunEvents(
                events,
                stage.agentRun.eventTimeline,
                stageIndex,
                agentId,
                turnState,
            );
        } else {
            appendSummaryAgentRunEvents(events, stage, stageIndex, agentId);
        }
    }
    if (attempt.outcome === 'failed') {
        events.push({
            type: 'error',
            timestamp: completedAt,
            turn: 0,
            data: {
                type: attempt.failureCategory ?? 'evaluation_failure',
                message: attempt.error
                    ?? [
                        attempt.failureCode ?? 'unknown failure',
                        attempt.failedStage ? `at ${attempt.failedStage}` : undefined,
                    ].filter(Boolean).join(' '),
            },
        });
    }
    if (fidelity === transcriptFidelity) {
        events.push({
            type: 'turn_end',
            timestamp: completedAt,
            turn: 0,
            data: { turnId: 'summary-adapter-turn-0' },
        });
    }

    const metrics = computeMetrics(events);
    const usage = sumUsage(attempt.stages);
    metrics.tokenUsage = {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: 0,
        callCount: usage.apiCalls,
        byModel: usage.apiCalls > 0 || usage.inputTokens > 0 || usage.outputTokens > 0
            ? {
                [model]: {
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    callCount: usage.apiCalls,
                },
            }
            : {},
        ...(usage.hasUsageEvidence && Number.isSafeInteger(usage.totalNanoAiu)
            ? {
                cost: {
                    provider: 'github-copilot' as const,
                    unit: 'nano-aiu' as const,
                    amount: usage.totalNanoAiu,
                },
            }
            : {}),
    };
    metrics.wallTimeMs = attempt.durationMs;
    return {
        id: `${adapterSource}:${attempt.runId}`,
        stimulus: {
            name: trajectoryStimulusName(attempt.scenarioId, model, source.summary.through),
            prompt,
            tags: {
                scenario: attempt.scenarioId,
                model,
                arm: source.summary.evaluationArm,
                endpoint: source.summary.through,
                transcriptFidelity: fidelity,
            },
        },
        events,
        metrics,
        output: capturedTrajectoryOutput(attempt),
        workDir: sourceArtifactDir,
        artifactDir: artifactDirectory,
        artifactDirStrict: true,
        metadata: {
            model,
            skillsLoaded: [],
            startedAt,
            completedAt,
            executor: adapterSource,
            sessionID: attempt.runId,
            source: adapterSource,
            transcriptFidelity: fidelity,
            tokenUsageFidelity: usageFidelity,
            outputProvenance: hasCapturedAssistantMessage(attempt)
                ? 'captured-assistant-message'
                : 'not-observed',
            ...(!hasCapturedAssistantMessage(attempt)
                ? {
                    outputOmissionReason: fidelity === transcriptFidelity
                        ? 'Historical summary has no captured original assistant response.'
                        : 'No assistant.message event was observed in the captured SDK timelines.',
                }
                : {}),
            summaryPath: source.summaryPath,
            sourceArtifactDir,
            evaluationArm: source.summary.evaluationArm,
            endpoint: source.summary.through,
            scenarioId: attempt.scenarioId,
            attempt: attempt.attempt,
            evaluationDefinitionHash: attempt.evaluationDefinition?.combinedHash,
        },
        ...(attempt.outcome === 'autonomous_success' ? { endReason: 'completed' as const } : {}),
    };
}

interface CapturedTurnState {
    next: number;
    byIdentity: Map<string, number>;
    currentByAgent: Map<string, number>;
}

function appendCapturedAgentRunEvents(
    events: TrajectoryEvent[],
    timeline: CorAgentTimelineEvent[],
    stageIndex: number,
    stageAgentId: string | undefined,
    turns: CapturedTurnState,
): void {
    const toolNames = new Map<string, string>();
    for (const event of timeline) {
        const agentId = capturedAgentId(stageAgentId, stageIndex, event.agentId);
        const turn = capturedTurnNumber(event, agentId, turns);
        const timestamp = validDate(event.timestamp);
        switch (event.type) {
            case 'assistant.message':
                events.push({
                    type: 'assistant_message',
                    timestamp,
                    turn,
                    agentId,
                    data: { content: event.content },
                });
                break;
            case 'assistant.turn_start':
                events.push({
                    type: 'turn_start',
                    timestamp,
                    turn,
                    agentId,
                    data: { turnId: event.turnId },
                });
                break;
            case 'assistant.turn_end':
                events.push({
                    type: 'turn_end',
                    timestamp,
                    turn,
                    agentId,
                    data: { turnId: event.turnId },
                });
                break;
            case 'tool.execution_start':
                toolNames.set(event.toolCallId, event.toolName);
                events.push({
                    type: 'tool_call',
                    timestamp,
                    turn,
                    agentId,
                    data: {
                        toolName: event.toolName,
                        toolCallId: event.toolCallId,
                        ...(event.turnId ? { turnId: event.turnId } : {}),
                        ...(isRecord(event.arguments) ? { arguments: event.arguments } : {}),
                    },
                });
                break;
            case 'tool.execution_complete': {
                const toolName = event.toolName ?? toolNames.get(event.toolCallId);
                if (!toolName) {
                    events.push({
                        type: 'custom',
                        timestamp,
                        turn,
                        agentId,
                        data: {
                            eventType: 'orphan_tool_execution_complete',
                            toolCallId: event.toolCallId,
                            success: event.success,
                        },
                    });
                    break;
                }
                events.push({
                    type: 'tool_result',
                    timestamp,
                    turn,
                    agentId,
                    data: {
                        toolName,
                        toolCallId: event.toolCallId,
                        success: event.success,
                        result: {
                            ...(event.result === undefined ? {} : { content: event.result }),
                            ...(event.error === undefined ? {} : { error: event.error }),
                            ...(event.resultTruncated ? { truncated: true } : {}),
                            ...(event.resultRedacted ? { redacted: true } : {}),
                        },
                    },
                });
                break;
            }
            case 'assistant.usage':
                events.push({
                    type: 'token_usage',
                    timestamp,
                    turn,
                    agentId,
                    data: {
                        inputTokens: event.inputTokens,
                        outputTokens: event.outputTokens,
                        model: event.model,
                        cacheReadTokens: event.cacheReadTokens,
                        cacheWriteTokens: event.cacheWriteTokens,
                        ...(event.totalNanoAiu === undefined
                            ? {}
                            : {
                                cost: {
                                    provider: 'github-copilot' as const,
                                    unit: 'nano-aiu' as const,
                                    amount: event.totalNanoAiu,
                                },
                            }),
                    },
                });
                break;
            case 'session.error':
                events.push({
                    type: 'error',
                    timestamp,
                    turn,
                    agentId,
                    data: {
                        type: event.errorType,
                        message: event.message,
                        ...(event.statusCode === undefined ? {} : { code: event.statusCode }),
                    },
                });
                break;
        }
    }
}

function capturedAgentId(
    stageAgentId: string | undefined,
    stageIndex: number,
    sdkAgentId: string | undefined,
): string {
    const stage = stageAgentId ?? `stage-${stageIndex}:session-unknown`;
    return sdkAgentId ? `${stage}/${sdkAgentId}` : stage;
}

function capturedTurnNumber(
    event: CorAgentTimelineEvent,
    agentId: string,
    state: CapturedTurnState,
): number {
    if (event.turnId) {
        const identity = `${agentId}\0${event.turnId}`;
        const existing = state.byIdentity.get(identity);
        if (existing !== undefined) {
            state.currentByAgent.set(agentId, existing);
            return existing;
        }
        const next = state.next++;
        state.byIdentity.set(identity, next);
        state.currentByAgent.set(agentId, next);
        return next;
    }
    const current = state.currentByAgent.get(agentId);
    if (current !== undefined) {
        return current;
    }
    const next = state.next++;
    state.currentByAgent.set(agentId, next);
    return next;
}

export function classifyTranscriptFidelity(attempt: AttemptEvidence): TranscriptFidelity {
    const runs = attempt.stages
        .map(stage => stage.agentRun)
        .filter((run): run is AgentRunEvidence => run !== undefined);
    if (!runs.length) {
        return transcriptFidelity;
    }
    const captured = runs.filter(run => Array.isArray(run.eventTimeline)).length;
    if (captured === 0) {
        return transcriptFidelity;
    }
    return captured === runs.length ? 'full' : 'mixed';
}

/**
 * Transcript-based prompt and panel grading is conservative: it is permitted only when at least
 * one real SDK timeline is present. Mixed trajectories remain explicitly partial, while historical
 * summary-only trajectories must use evaluator-grounded satisfaction packets.
 */
export function canUseTranscriptForQualitativeGrading(fidelity: TranscriptFidelity): boolean {
    return fidelity === 'full' || fidelity === 'mixed';
}

function classifyTrajectoryCollection(attempts: ConvertedAttempt[]): TranscriptFidelity {
    if (!attempts.length) {
        return transcriptFidelity;
    }
    const values = new Set(attempts.map(attempt => attempt.trajectory.metadata.transcriptFidelity));
    return values.size === 1 ? [...values][0] : 'mixed';
}

function tokenUsageFidelity(fidelity: TranscriptFidelity): TokenUsageFidelity {
    if (fidelity === 'full') {
        return 'event-timeline';
    }
    return fidelity === 'mixed' ? 'mixed' : 'stage-summary';
}

function hasCapturedAssistantMessage(attempt: AttemptEvidence): boolean {
    return attempt.stages.some(stage =>
        stage.agentRun?.eventTimeline?.some(event => event.type === 'assistant.message'));
}

function capturedTrajectoryOutput(attempt: AttemptEvidence): string {
    const messages = attempt.stages.flatMap(stage =>
        stage.agentRun?.eventTimeline
            ?.filter(event => event.type === 'assistant.message')
            .map(event => event.content) ?? []);
    return messages.join('\n\n');
}

function appendSummaryAgentRunEvents(
    events: TrajectoryEvent[],
    stage: StageEvidence,
    stageIndex: number,
    agentId: string | undefined,
): void {
    const run = stage.agentRun;
    if (!run) {
        return;
    }
    for (const tool of run.toolCalls ?? []) {
        const toolName = nonEmpty(tool.toolName);
        const toolCallId = nonEmpty(tool.toolCallId);
        if (!toolName || !toolCallId) {
            continue;
        }
        events.push({
            type: 'tool_call',
            timestamp: validDate(tool.startedAt),
            turn: 0,
            agentId,
            data: {
                toolName,
                toolCallId,
                turnId: `stage-${stageIndex}`,
            },
        });
        if (typeof tool.success === 'boolean') {
            events.push({
                type: 'tool_result',
                timestamp: validDate(tool.completedAt),
                turn: 0,
                agentId,
                data: {
                    toolName,
                    toolCallId,
                    success: tool.success,
                    result: {
                        transcriptFidelity,
                        ...(tool.error ? { error: tool.error } : {}),
                    },
                },
            });
        }
    }
    for (const error of run.errors ?? []) {
        events.push({
            type: 'error',
            timestamp: validDate(run.completedAt),
            turn: 0,
            agentId,
            data: { type: 'agent_run_error', message: error },
        });
    }
    const usage = run.usage;
    if (!usage) {
        return;
    }
    const models = uniqueStrings(usage.models ?? []);
    const inputTokens = nonNegativeNumber(usage.inputTokens);
    const outputTokens = nonNegativeNumber(usage.outputTokens);
    const cacheReadTokens = nonNegativeNumber(usage.cacheReadTokens);
    const totalNanoAiu = nonNegativeNumber(usage.totalNanoAiu);
    events.push({
        type: 'custom',
        timestamp: validDate(run.completedAt),
        turn: 0,
        agentId,
        data: {
            eventType: 'stage_token_cost_summary',
            stageIndex,
            aggregation: 'stage-summary',
            apiCalls: nonNegativeNumber(usage.apiCalls),
            inputTokens,
            outputTokens,
            reasoningTokens: nonNegativeNumber(usage.reasoningTokens),
            cacheReadTokens,
            totalNanoAiu,
            models,
        },
    });
}

export function createCustomMetrics(
    summary: SummaryEvidence,
    attempt: AttemptEvidence,
    scenario: CorEvaluationScenario,
    supplementalEvidence?: SupplementalAttemptEvidence,
): CustomMetricsDocument {
    const localApplies = summary.through === 'local';
    const browserContracts = localApplies
        ? (scenario.acceptance?.local?.probes ?? []).filter(probe => probe.browser)
        : [];
    const persistenceContracts = browserContracts.filter(probe => probe.browser?.persistence);
    const workerContracts = localApplies ? (scenario.acceptance?.local?.storageEvents ?? []) : [];
    const debuggerApplicable = localApplies && scenario.acceptance?.local?.debugParity !== undefined;
    const localEvidence = attempt.stages
        .map(stage => stage.localRuntimeValidation)
        .filter((evidence): evidence is LocalRuntimeEvidence => evidence !== undefined);
    const browserEvidence = localEvidence.flatMap(evidence => evidence.browserChecks ?? []);
    const persistenceEvidence = localEvidence.flatMap(evidence => evidence.persistenceChecks ?? []);
    const workerEvidence = localEvidence.flatMap(evidence => evidence.workerEvents ?? []);
    const localDebuggerEvidence = localEvidence.flatMap(evidence =>
        (evidence.commands ?? []).filter(command => command.kind === 'debugger'));
    const debuggerEvidence = supplementalEvidence?.vscodeParityOutcome
        ? [{ success: supplementalEvidence.vscodeParityOutcome === 'passed' }]
        : localDebuggerEvidence;

    const browser = gateMetric(browserContracts.length > 0, browserEvidence, browserContracts.length);
    const persistence = gateMetric(
        persistenceContracts.length > 0,
        persistenceEvidence,
        persistenceContracts.length,
    );
    const worker = gateMetric(workerContracts.length > 0, workerEvidence, workerContracts.length);
    const debuggerGate = gateMetric(
        debuggerApplicable,
        debuggerEvidence,
        debuggerApplicable ? 1 : 0,
    );
    const accessibilityApplicable = browserContracts.length > 0;
    const accessibilityScans = browserEvidence.filter(check => check.accessibilityScanned === true);
    const accessibilityEvidence = browserEvidence.filter(check =>
        check.accessibilityScanned !== undefined
        || check.accessibilityScanError !== undefined
        || check.seriousAccessibilityViolations !== undefined);
    const accessibilityFindings = accessibilityScans.reduce(
        (sum, check) => sum + (check.seriousAccessibilityViolations?.length ?? 0),
        0,
    );
    const accessibilityPassed = accessibilityApplicable
        && accessibilityScans.length >= browserContracts.length
        && browserEvidence.every((check, index) => {
            const configured = browserContracts[index]?.browser?.maxSeriousAccessibilityViolations;
            if (configured === null) {
                return check.accessibilityScanned === true && !check.accessibilityScanError;
            }
            const max = configured ?? 0;
            return check.accessibilityScanned === true
                && !check.accessibilityScanError
                && (check.seriousAccessibilityViolations?.length ?? 0) <= max;
        });
    const accessibilityStatus = applicabilityStatus(
        accessibilityApplicable,
        accessibilityEvidence.length >= browserContracts.length,
        accessibilityPassed,
    );
    const deploymentOutcome = supplementalEvidence?.deploymentOutcome
        ?? findDeploymentOutcome(attempt);
    const deploymentPresent = deploymentOutcome !== undefined;
    const usage = sumUsage(attempt.stages);
    const productQualityIncluded = ![
        'harness_failure',
        'infrastructure_failure',
    ].includes(attempt.failureCategory ?? '');
    const autonomousSuccess = attempt.outcome === 'autonomous_success';
    const deploymentSuccess = deploymentPresent ? deploymentOutcome === 'passed' : null;
    const authoritativeHardGatesPassed = autonomousSuccess
        && nullableGatePassed(browser.success)
        && nullableGatePassed(accessibilityApplicable ? accessibilityPassed : null)
        && nullableGatePassed(persistence.success)
        && nullableGatePassed(worker.success)
        && nullableGatePassed(debuggerGate.success)
        && nullableGatePassed(deploymentSuccess);

    return {
        schema: metricsSchema,
        source: adapterSource,
        transcriptFidelity: classifyTranscriptFidelity(attempt),
        values: {
            autonomous_success: autonomousSuccess,
            final_product_success: autonomousSuccess,
            first_pass_success: autonomousSuccess && (attempt.agentRetries ?? 0) === 0,
            product_quality_included: productQualityIncluded,
            product_quality_success: productQualityIncluded ? autonomousSuccess : null,
            repair_count: attempt.agentRetries ?? countRepairStages(attempt.stages),
            stage_depth: attempt.stages.length,
            duration_ms: attempt.durationMs,
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            reasoning_tokens: usage.reasoningTokens,
            cache_read_tokens: usage.cacheReadTokens,
            total_tokens: usage.inputTokens + usage.outputTokens,
            total_nano_aiu: usage.totalNanoAiu,
            browser_functional_applicable: browser.applicable,
            browser_functional_status: browser.status,
            browser_functional_success: browser.success,
            browser_check_count: browser.count,
            accessibility_applicable: accessibilityApplicable,
            accessibility_status: accessibilityStatus,
            accessibility_success: accessibilityApplicable ? accessibilityPassed : null,
            accessibility_scan_count: accessibilityApplicable ? accessibilityScans.length : null,
            accessibility_finding_count: accessibilityApplicable ? accessibilityFindings : null,
            persistence_applicable: persistence.applicable,
            persistence_status: persistence.status,
            persistence_success: persistence.success,
            persistence_check_count: persistence.count,
            worker_event_applicable: worker.applicable,
            worker_event_status: worker.status,
            worker_event_success: worker.success,
            worker_event_check_count: worker.count,
            debugger_evidence_applicable: debuggerGate.applicable,
            debugger_evidence_status: debuggerGate.status,
            debugger_evidence_success: debuggerGate.success,
            debugger_check_count: debuggerGate.count,
            deployment_evidence_present: deploymentPresent,
            deployment_status: deploymentPresent
                ? (deploymentSuccess ? 'passed' : 'failed')
                : 'not-applicable',
            deployment_success: deploymentSuccess,
            authoritative_hard_gates_passed: authoritativeHardGatesPassed,
        },
    };
}

export function createHardGateGraders(metrics: CustomMetricsDocument): StimulusGraderConfig[] {
    const values = metrics.values;
    const assertions: Record<string, unknown>[] = [
        { metric: 'final_product_success', equals: true },
        { metric: 'authoritative_hard_gates_passed', equals: true },
    ];
    const conditionalGates: Array<[boolean, string]> = [
        [values.browser_functional_applicable, 'browser_functional_success'],
        [values.accessibility_applicable, 'accessibility_success'],
        [values.persistence_applicable, 'persistence_success'],
        [values.worker_event_applicable, 'worker_event_success'],
        [values.debugger_evidence_applicable, 'debugger_evidence_success'],
        [values.deployment_evidence_present, 'deployment_success'],
    ];
    for (const [applicable, metric] of conditionalGates) {
        if (applicable) {
            assertions.push({ metric, equals: true });
        }
    }
    return [{
        type: 'custom-metrics',
        name: 'authoritative-hard-gates',
        config: {
            path: 'custom_metrics.json',
            assertions,
        },
    }];
}

export function createGroupReports(attempts: ConvertedAttempt[]): VallyGroupReport[] {
    const groups = new Map<string, ConvertedAttempt[]>();
    for (const attempt of attempts) {
        const key = [
            attempt.arm,
            attempt.model,
            attempt.scenarioId,
            attempt.endpoint,
        ].join('\0');
        const group = groups.get(key) ?? [];
        group.push(attempt);
        groups.set(key, group);
    }
    return [...groups.values()].map(group => {
        group.sort(compareConvertedAttempts);
        const first = group[0];
        const trialGrades = group.map(item => ({
            grade: item.effectiveGrade,
            passed: item.effectiveGrade.passed,
        }));
        const stimulusScore = computeStimulusScore(first.scenarioId, trialGrades, true);
        const skillScore = computeSkillScore(
            `${first.arm}:${first.model}:${first.endpoint}`,
            [stimulusScore],
            1,
        );
        const successes = trialGrades.filter(trial => trial.passed).length;
        const passAtKValues: Record<string, number> = {};
        const passToTheKValues: Record<string, number> = {};
        for (let k = 1; k <= group.length; k++) {
            passAtKValues[String(k)] = passAtK(group.length, successes, k);
            passToTheKValues[String(k)] = passToTheK(successes / group.length, k);
        }
        return {
            arm: first.arm,
            model: first.model,
            scenarioId: first.scenarioId,
            endpoint: first.endpoint,
            trials: group.length,
            successes,
            passRate: stimulusScore.multiTrial.perTrialPassRate,
            passAtK: passAtKValues,
            passToTheK: passToTheKValues,
            flaky: stimulusScore.flaky,
            flakinessPercent: stimulusScore.flakinessPercent,
            aggregateScore: stimulusScore.aggregateScore,
            vallyStimulusScore: stimulusScore,
            vallySkillScore: skillScore,
        };
    }).sort((left, right) =>
        left.model.localeCompare(right.model)
        || left.scenarioId.localeCompare(right.scenarioId)
        || left.endpoint.localeCompare(right.endpoint)
        || left.arm.localeCompare(right.arm));
}

export function createPairingManifest(
    treatment: ConvertedAttempt[],
    baseline: ConvertedAttempt[],
): PairingManifest {
    const treatmentByKey = uniquePairingMap(treatment, 'treatment');
    const baselineByKey = uniquePairingMap(baseline, 'baseline');
    const pairs: PairingManifest['pairs'] = [];
    const unmatchedTreatment: string[] = [];
    let hasQualitativeTranscriptPair = false;
    for (const [key, candidate] of treatmentByKey) {
        const control = baselineByKey.get(key);
        if (!control) {
            unmatchedTreatment.push(key);
            continue;
        }
        if (
            (candidate.evaluationDefinition !== undefined || control.evaluationDefinition !== undefined)
            && (
                candidate.evaluationDefinition === undefined
                || control.evaluationDefinition === undefined
                || !sameEvaluationDefinition(candidate.evaluationDefinition, control.evaluationDefinition)
            )
        ) {
            throw new Error(
                `Paired Vally attempt ${key} evaluation definition mismatch: `
                + `Rails "${candidate.evaluationDefinition?.combinedHash ?? 'legacy_missing'}", `
                + `baseline "${control.evaluationDefinition?.combinedHash ?? 'legacy_missing'}".`,
            );
        }
        pairs.push({
            key,
            model: candidate.model,
            scenarioId: candidate.scenarioId,
            attempt: candidate.attempt,
            endpoint: candidate.endpoint,
            treatmentTrajectoryId: candidate.trajectory.id,
            baselineTrajectoryId: control.trajectory.id,
        });
        hasQualitativeTranscriptPair ||= canUseTranscriptForQualitativeGrading(
            candidate.trajectory.metadata.transcriptFidelity,
        ) && canUseTranscriptForQualitativeGrading(
            control.trajectory.metadata.transcriptFidelity,
        );
    }
    const unmatchedBaseline = [...baselineByKey.keys()].filter(key => !treatmentByKey.has(key));
    pairs.sort((left, right) => left.key.localeCompare(right.key));
    unmatchedTreatment.sort();
    unmatchedBaseline.sort();
    return {
        schemaVersion: '1',
        source: adapterSource,
        matchingKey: 'model+scenarioId+attempt+endpoint',
        qualitativeComparison: {
            performed: false,
            reason: hasQualitativeTranscriptPair
                ? 'not performed by this offline adapter; full/mixed transcript pairs are eligible through the satisfaction evaluator'
                : 'summary-only trajectories are not valid evidence for qualitative LLM judging',
        },
        pairs,
        unmatchedTreatment,
        unmatchedBaseline,
    };
}

export function createModelExperiments(
    treatment: ConvertedAttempt[],
    baseline: ConvertedAttempt[],
): VallyModelExperiment[] {
    const models = uniqueStrings([...treatment, ...baseline].map(value => value.model));
    return models.map(model => {
        const candidate = treatment.filter(value => value.model === model);
        const control = baseline.filter(value => value.model === model);
        const candidateKeys = new Set(candidate.map(pairingKey));
        const controlKeys = new Set(control.map(pairingKey));
        const exactPairs = [...candidateKeys].filter(key => controlKeys.has(key)).length;
        const treatmentPassRate = passRate(candidate);
        const baselinePassRate = passRate(control);
        return {
            model,
            treatmentTrials: candidate.length,
            baselineTrials: control.length,
            exactPairs,
            unmatchedTreatment: candidate.length - exactPairs,
            unmatchedBaseline: control.length - exactPairs,
            treatmentPassRate,
            baselinePassRate,
            passRateDelta: treatmentPassRate === null || baselinePassRate === null
                ? null
                : treatmentPassRate - baselinePassRate,
            treatmentAggregateScore: averageScore(candidate),
            baselineAggregateScore: averageScore(control),
        };
    });
}

function passRate(attempts: ConvertedAttempt[]): number | null {
    return attempts.length
        ? attempts.filter(attempt => attempt.effectiveGrade.passed).length / attempts.length
        : null;
}

function averageScore(attempts: ConvertedAttempt[]): number | null {
    return attempts.length
        ? attempts.reduce((total, attempt) => total + attempt.effectiveGrade.score, 0) / attempts.length
        : null;
}

export function toTrialResultRecord(
    attempt: ConvertedAttempt,
    totalTrials: number,
): TrialResultRecord {
    const gradeResult = {
        ...attempt.grade,
        stimulusName: attempt.trajectory.stimulus.name,
        trajectoryId: attempt.trajectory.id,
        timestamp: new Date(),
    };
    return {
        type: 'trial-result',
        itemId: `${attempt.trajectory.id}__trial-${attempt.attempt}`,
        evalName: 'copilot-on-rails-offline-summary',
        evalFilePath: regradeEvalFilePath,
        variant: attempt.arm,
        stimulus: attempt.trajectory.stimulus.name,
        model: attempt.model,
        trialIndex: attempt.attempt - 1,
        totalTrials,
        status: 'success',
        durationMs: attempt.trajectory.metrics.wallTimeMs,
        gradeResult: {
            ...gradeResult,
            ...attempt.effectiveGrade,
        },
        trajectory: attempt.trajectory,
    };
}

function createRegradeSpec(attempts: ConvertedAttempt[]): Record<string, unknown> {
    const byStimulus = new Map<string, ConvertedAttempt>();
    for (const attempt of attempts) {
        byStimulus.set(attempt.trajectory.stimulus.name, attempt);
    }
    return {
        name: 'copilot-on-rails-offline-regrade',
        description: 'Generated custom-metrics grader contract for archived summary trajectories.',
        version: '1',
        type: 'capability',
        defaults: {
            runs: 1,
            executor: 'mock',
        },
        stimuli: [...byStimulus.values()]
            .sort(compareConvertedAttempts)
            .map(attempt => ({
                name: attempt.trajectory.stimulus.name,
                prompt: 'Offline re-grade of archived summary metrics; this prompt is never executed.',
                tags: {
                    component: 'copilot-on-rails',
                    evidence: attempt.trajectory.metadata.transcriptFidelity,
                    model: attempt.model,
                    scenario: attempt.scenarioId,
                    endpoint: attempt.endpoint,
                },
                graders: attempt.graderConfigs,
            })),
        scoring: {
            weights: { 'custom-metrics': 1 },
            threshold: 1,
        },
    };
}

async function writeRecords(directory: string, attempts: ConvertedAttempt[]): Promise<void> {
    await fs.mkdir(directory, { recursive: true });
    const counts = new Map<string, number>();
    for (const attempt of attempts) {
        const key = groupKey(attempt);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const lines = attempts.map(attempt =>
        JSON.stringify(toTrialResultRecord(attempt, counts.get(groupKey(attempt)) as number)));
    await fs.writeFile(
        path.join(directory, 'results.jsonl'),
        lines.length > 0 ? `${lines.join('\n')}\n` : '',
    );
}

async function loadAndValidateSummaries(
    inputs: string[],
    expectedArm: EvaluationArm,
    scenarioById: ReadonlyMap<string, CorEvaluationScenario>,
    seenRunIds: Set<string>,
): Promise<LoadedSummary[]> {
    const loaded: LoadedSummary[] = [];
    for (const input of inputs) {
        const resolved = path.resolve(input);
        const stat = await fs.stat(resolved);
        const summaryPath = stat.isDirectory() ? path.join(resolved, 'summary.json') : resolved;
        const parsed: unknown = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
        loaded.push({
            summary: validateSummary(parsed, summaryPath, expectedArm, scenarioById, seenRunIds),
            summaryPath,
        });
    }
    return loaded;
}

export function validateSummary(
    value: unknown,
    summaryPath: string,
    expectedArm: EvaluationArm,
    scenarioById: ReadonlyMap<string, CorEvaluationScenario>,
    seenRunIds = new Set<string>(),
): SummaryEvidence {
    if (!isRecord(value)) {
        throw new Error(`Summary must be a JSON object: ${summaryPath}`);
    }
    if (value.schemaVersion !== '1' || value.evaluationArm !== expectedArm) {
        throw new Error(
            `Summary ${summaryPath} must declare schemaVersion "1" and evaluationArm "${expectedArm}".`,
        );
    }
    for (const field of ['candidateCommit', 'agentAssetsHash', 'through'] as const) {
        if (!nonEmpty(value[field])) {
            throw new Error(`Summary ${summaryPath} is missing ${field} provenance.`);
        }
    }
    if (!Array.isArray(value.results) || value.results.length === 0) {
        throw new Error(`Summary ${summaryPath} must contain at least one result.`);
    }
    const summary = value as unknown as SummaryEvidence;
    const summaryDefinitions = summary.evaluationDefinitions;
    if (
        summaryDefinitions !== undefined
        && (!Array.isArray(summaryDefinitions)
            || !summaryDefinitions.length
            || summaryDefinitions.some(definition => !isEvaluationDefinitionProvenance(definition)))
    ) {
        throw new Error(`Summary ${summaryPath} has malformed evaluation-definition provenance.`);
    }
    if (expectedArm === 'baseline-controlled') {
        validateBaselineProvenance(summary.sourceProvenance, summaryPath);
    }
    for (const [index, attempt] of summary.results.entries()) {
        const label = `${summaryPath} result ${index}`;
        if (!isRecord(attempt)
            || attempt.schemaVersion !== '1'
            || (attempt.evaluationArm !== undefined && attempt.evaluationArm !== expectedArm)
            || !nonEmpty(attempt.runId)
            || !nonEmpty(attempt.scenarioId)
            || !Number.isInteger(attempt.attempt)
            || attempt.attempt < 1
            || !['autonomous_success', 'failed'].includes(attempt.outcome)
            || !Number.isFinite(attempt.durationMs)
            || attempt.durationMs < 0
            || !Array.isArray(attempt.stages)) {
            throw new Error(`Invalid evaluation attempt provenance at ${label}.`);
        }
        if (!scenarioById.has(attempt.scenarioId)) {
            throw new Error(`Unknown scenario "${attempt.scenarioId}" at ${label}.`);
        }
        if ((attempt.candidateCommit !== undefined
                && attempt.candidateCommit !== summary.candidateCommit)
            || (attempt.agentAssetsHash !== undefined
                && attempt.agentAssetsHash !== summary.agentAssetsHash)) {
            throw new Error(`Attempt provenance conflicts with its summary at ${label}.`);
        }
        if (attempt.evaluationDefinition !== undefined
            && !isEvaluationDefinitionProvenance(attempt.evaluationDefinition)) {
            throw new Error(`Attempt evaluation-definition provenance is malformed at ${label}.`);
        }
        if (
            attempt.evaluationDefinition
            && !summaryDefinitions?.some(definition =>
                sameEvaluationDefinition(definition, attempt.evaluationDefinition as EvaluationDefinitionProvenance))
        ) {
            throw new Error(`Attempt evaluation-definition provenance conflicts with its summary at ${label}.`);
        }
        if (seenRunIds.has(attempt.runId)) {
            throw new Error(`Duplicate runId "${attempt.runId}" across Vally inputs.`);
        }
        seenRunIds.add(attempt.runId);
        const model = resolveAttemptModel(summary, attempt as unknown as AttemptEvidence);
        const observed = uniqueStrings(
            (attempt.observedModels as string[] | undefined) ?? summary.observedModels ?? [],
        );
        if (observed.length === 0 || observed.some(observedModel => observedModel !== model)) {
            throw new Error(
                `Attempt "${attempt.runId}" must record only its requested model "${model}" as observed.`,
            );
        }
        if (expectedArm === 'baseline-controlled') {
            validateBaselineProvenance(
                (attempt.sourceProvenance as SourceProvenance | undefined) ?? summary.sourceProvenance,
                label,
            );
        }
    }
    return summary;
}

function validateBaselineProvenance(provenance: SourceProvenance | undefined, label: string): void {
    if (!provenance
        || provenance.promptField !== 'baselinePrompt'
        || !nonEmpty(provenance.promptSource)
        || !nonEmpty(provenance.agentIdentity)
        || provenance.railsAssetsInjected !== false
        || provenance.customToolsInjected !== false) {
        throw new Error(`Baseline source provenance is incomplete or unsafe: ${label}`);
    }
}

function resolveAttemptModel(summary: SummaryEvidence, attempt: AttemptEvidence): string {
    const requested = nonEmpty(attempt.requestedModel)
        ?? nonEmpty(summary.requestedModel)
        ?? (summary.requestedModels?.length === 1 ? nonEmpty(summary.requestedModels[0]) : undefined);
    const model = requested ?? nonEmpty(attempt.model);
    if (!model) {
        throw new Error(`Attempt "${attempt.runId}" is missing a requested model pin.`);
    }
    if (attempt.model && attempt.model !== model) {
        throw new Error(`Attempt "${attempt.runId}" model does not match its requested model.`);
    }
    return model;
}

function gateMetric(
    applicable: boolean,
    evidence: SuccessEvidence[],
    requiredCount: number,
): { applicable: boolean; status: GateStatus; success: boolean | null; count: number | null } {
    if (!applicable) {
        return { applicable: false, status: 'not-applicable', success: null, count: null };
    }
    const enoughEvidence = evidence.length >= requiredCount;
    const success = enoughEvidence && evidence.every(item => item.success === true);
    return {
        applicable: true,
        status: applicabilityStatus(true, enoughEvidence, success),
        success,
        count: evidence.length,
    };
}

function applicabilityStatus(applicable: boolean, evidencePresent: boolean, passed: boolean): GateStatus {
    if (!applicable) {
        return 'not-applicable';
    }
    if (!evidencePresent) {
        return 'missing-evidence';
    }
    return passed ? 'passed' : 'failed';
}

function findDeploymentOutcome(attempt: AttemptEvidence): string | undefined {
    if (attempt.deploymentValidation?.outcome) {
        return attempt.deploymentValidation.outcome;
    }
    for (const stage of attempt.stages) {
        if (stage.deploymentValidation?.outcome) {
            return stage.deploymentValidation.outcome;
        }
        if (stage.name?.startsWith('deploy')) {
            return stage.validation?.valid === true ? 'passed' : 'failed';
        }
    }
    return undefined;
}

function sumUsage(stages: StageEvidence[]): {
    apiCalls: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    totalNanoAiu: number;
    hasUsageEvidence: boolean;
} {
    return stages.reduce((total, stage) => {
        const usage = stage.agentRun?.usage;
        if (usage) {
            total.hasUsageEvidence = true;
        }
        total.apiCalls += nonNegativeNumber(usage?.apiCalls);
        total.inputTokens += nonNegativeNumber(usage?.inputTokens);
        total.outputTokens += nonNegativeNumber(usage?.outputTokens);
        total.reasoningTokens += nonNegativeNumber(usage?.reasoningTokens);
        total.cacheReadTokens += nonNegativeNumber(usage?.cacheReadTokens);
        total.totalNanoAiu += nonNegativeNumber(usage?.totalNanoAiu);
        return total;
    }, {
        apiCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        totalNanoAiu: 0,
        hasUsageEvidence: false as boolean,
    });
}

function countRepairStages(stages: StageEvidence[]): number {
    return stages.filter(stage => stage.name?.includes('repair')).length;
}

function nullableGatePassed(value: boolean | null): boolean {
    return value === null || value;
}

function uniquePairingMap(
    attempts: ConvertedAttempt[],
    label: string,
): Map<string, ConvertedAttempt> {
    const result = new Map<string, ConvertedAttempt>();
    for (const attempt of attempts) {
        const key = pairingKey(attempt);
        if (result.has(key)) {
            throw new Error(`Ambiguous duplicate ${label} pairing key: ${key}`);
        }
        result.set(key, attempt);
    }
    return result;
}

function pairingKey(attempt: ConvertedAttempt): string {
    return [
        attempt.model,
        attempt.scenarioId,
        String(attempt.attempt),
        attempt.endpoint,
    ].join('::');
}

function groupKey(attempt: ConvertedAttempt): string {
    return [attempt.arm, attempt.model, attempt.scenarioId, attempt.endpoint].join('\0');
}

function trajectoryStimulusName(scenarioId: string, model: string, endpoint: string): string {
    return `${scenarioId} [model:${model}] [endpoint:${endpoint}]`;
}

function compareConvertedAttempts(left: ConvertedAttempt, right: ConvertedAttempt): number {
    return left.model.localeCompare(right.model)
        || left.scenarioId.localeCompare(right.scenarioId)
        || left.endpoint.localeCompare(right.endpoint)
        || left.attempt - right.attempt
        || left.arm.localeCompare(right.arm)
        || left.runId.localeCompare(right.runId);
}

function renderMarkdown(report: VallyAdapterReport): string {
    const lines = [
        '# Copilot on Rails Vally experiment and release report',
        '',
        `Generated: ${report.generatedAt}`,
        '',
        `Source: \`${report.source}\`; transcript fidelity: \`${report.transcriptFidelity}\`.`,
        'Authoritative ACA/browser/debugger/deployment validators feed Vally custom graders. '
            + 'Hard-gate failures are normalized to aggregate score 0; this report invokes no qualitative judge.',
        '',
        '## Release Assessment',
        '',
        `Recommendation: **${report.releaseAssessment.recommendation}**`,
        '',
        ...report.releaseAssessment.reasons.map(reason => `- ${reason}`),
        '',
        `Threshold set: \`${report.releaseGates.thresholdSet}\` (schema ${report.releaseGates.thresholdSchemaVersion}).`,
        '',
        '| Gate | Measured value | Threshold | Status | Rationale |',
        '| --- | --- | --- | --- | --- |',
        ...report.releaseGates.results.map(gate =>
            `| ${escapeMarkdownTable(gate.title)} | ${escapeMarkdownTable(renderGateValue(gate.measuredValue))} | `
            + `${escapeMarkdownTable(gate.threshold)} | **${gate.status}** | `
            + `${escapeMarkdownTable(gate.rationale)} |`),
        '',
        '## Same-model Experiments',
        '',
        '| Model | Rails trials | Baseline trials | Exact pairs | Rails pass | Baseline pass | Delta | Rails score | Baseline score |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...report.experiments.map(experiment =>
            `| ${experiment.model} | ${experiment.treatmentTrials} | ${experiment.baselineTrials} | `
            + `${experiment.exactPairs} | ${formatOptionalPercent(experiment.treatmentPassRate)} | `
            + `${formatOptionalPercent(experiment.baselinePassRate)} | `
            + `${formatSignedOptionalPercent(experiment.passRateDelta)} | `
            + `${formatOptionalScore(experiment.treatmentAggregateScore)} | `
            + `${formatOptionalScore(experiment.baselineAggregateScore)} |`),
        '',
        '## Vally Trial Reliability',
        '',
        '| Arm | Model | Scenario | Endpoint | Pass rate | pass@k | pass^k | Flaky | Score |',
        '| --- | --- | --- | --- | ---: | ---: | ---: | --- | ---: |',
        ...report.groups.map(group => {
            const k = String(group.trials);
            return `| ${group.arm} | ${group.model} | ${group.scenarioId} | ${group.endpoint} | `
                + `${formatPercent(group.passRate)} | ${formatPercent(group.passAtK[k])} | `
                + `${formatPercent(group.passToTheK[k])} | ${group.flaky ? 'yes' : 'no'} | `
                + `${group.aggregateScore.toFixed(3)} |`;
        }),
        '',
        `Exact treatment/baseline pairs: ${report.pairing.pairs.length}.`,
        `Unmatched treatment: ${report.pairing.unmatchedTreatment.length}; `
            + `unmatched baseline: ${report.pairing.unmatchedBaseline.length}.`,
        '',
        `> Qualitative comparison was not performed: ${report.pairing.qualitativeComparison.reason}.`,
        '',
    ];
    return `${lines.join('\n')}\n`;
}

function formatPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function formatOptionalPercent(value: number | null): string {
    return value === null ? 'missing' : formatPercent(value);
}

function formatSignedOptionalPercent(value: number | null): string {
    return value === null ? 'missing' : `${value > 0 ? '+' : ''}${formatPercent(value)}`;
}

function formatOptionalScore(value: number | null): string {
    return value === null ? 'missing' : value.toFixed(3);
}

function renderGateValue(value: ReleaseGateResult['measuredValue']): string {
    return value === null ? 'missing' : typeof value === 'number' ? String(value) : value;
}

function escapeMarkdownTable(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sanitizePathSegment(value: string): string {
    const sanitized = value.replace(/[^A-Za-z0-9._-]/g, '_');
    if (!sanitized || sanitized === '.' || sanitized === '..') {
        throw new Error(`runId cannot be used as an artifact directory: ${value}`);
    }
    return sanitized;
}

function nonNegativeNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.filter(value => typeof value === 'string' && value.length > 0))].sort();
}

function nonEmpty(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validDate(value: string | undefined): Date | undefined {
    if (!value) {
        return undefined;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function earliestDate(values: (string | undefined)[]): Date | undefined {
    const dates = values.map(validDate).filter((value): value is Date => value !== undefined);
    return dates.length > 0
        ? new Date(Math.min(...dates.map(date => date.getTime())))
        : undefined;
}

function latestDate(values: (string | undefined)[]): Date | undefined {
    const dates = values.map(validDate).filter((value): value is Date => value !== undefined);
    return dates.length > 0
        ? new Date(Math.max(...dates.map(date => date.getTime())))
        : undefined;
}

export function parseVallyArgs(args: string[]): VallyAdapterOptions | 'help' {
    const options: VallyAdapterOptions = {
        inputs: [],
        baselineInputs: [],
        vscodeParityInputs: [],
        deploymentInputs: [],
        thresholdsPath: defaultReleaseThresholdsPath,
        outputDirectory: path.resolve('evals/results/vally'),
    };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        switch (arg) {
            case '--help':
            case '-h':
                return 'help';
            case '--input':
                options.inputs.push(requireValue(args, ++index, arg));
                break;
            case '--baseline':
                options.baselineInputs.push(requireValue(args, ++index, arg));
                break;
            case '--vscode-parity':
                options.vscodeParityInputs.push(requireValue(args, ++index, arg));
                break;
            case '--deployment':
                options.deploymentInputs.push(requireValue(args, ++index, arg));
                break;
            case '--thresholds':
                options.thresholdsPath = requireValue(args, ++index, arg);
                break;
            case '--output':
                options.outputDirectory = path.resolve(requireValue(args, ++index, arg));
                break;
            default:
                throw new Error(`Unknown argument "${arg}".`);
        }
    }
    if (options.inputs.length === 0) {
        throw new Error('At least one --input <summary.json> is required.');
    }
    return options;
}

function requireValue(args: string[], index: number, option: string): string {
    const value = args[index];
    if (!value || value.startsWith('--')) {
        throw new Error(`${option} requires a value.`);
    }
    return value;
}

function printHelp(): void {
    process.stdout.write([
        'Usage: npm run eval:cor:vally -- --input <summary.json> [options]',
        '',
        'Create the primary Vally experiment, grading, comparison, reliability, and release report',
        'from authoritative Copilot on Rails evidence. This command invokes no agent/model/judge.',
        '',
        'Options:',
        '  --input <summary.json>     Treatment summary (repeatable; directories are accepted)',
        '  --baseline <summary.json>  Controlled-baseline summary (repeatable)',
        '  --vscode-parity <json>     Provenance-bound debugger result (repeatable)',
        '  --deployment <json>        Provenance-bound live deployment result (repeatable)',
        '  --thresholds <json>        Versioned release thresholds',
        '  --output <dir>             Output directory (default: evals/results/vally)',
        '  -h, --help                 Show this help',
        '',
    ].join('\n'));
}

async function main(): Promise<void> {
    const options = parseVallyArgs(process.argv.slice(2));
    if (options === 'help') {
        printHelp();
        return;
    }
    await runVallyAdapter(options);
}

if (require.main === module) {
    void main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
