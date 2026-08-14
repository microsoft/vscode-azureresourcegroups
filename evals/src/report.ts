/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import { isLocalRuntimeInfrastructureFailureCode } from './SandboxLocalRuntimeValidator';
import { isSandboxInfrastructureFailureCode } from './SandboxProjectValidator';
import { isDeploymentInfrastructureFailureCode } from './deploymentReadiness';
import { SandboxVsCodeParityResult } from './SandboxVsCodeParityValidator';
import { LiveDeploymentResult } from './liveDeploy';
import {
    EvaluationDefinitionProvenance,
    isEvaluationDefinitionProvenance,
    sameEvaluationDefinition,
} from './evaluationDefinition';
import {
    ReleaseThresholds,
    defaultReleaseThresholdsPath,
    loadReleaseThresholds,
} from './releaseThresholds';
import { CorEvaluationScenario, loadScenarios } from './scenario';

type FailureCategory = 'product_failure' | 'harness_failure' | 'infrastructure_failure';

export interface EvaluationAttempt {
    evaluationArm?: 'rails' | 'baseline-controlled';
    runId: string;
    scenarioId: string;
    attempt: number;
    outcome: 'autonomous_success' | 'failed';
    failedStage?: string;
    failureCode?: string;
    failureCategory?: FailureCategory;
    candidateCommit?: string;
    agentAssetsHash?: string;
    evaluationDefinition?: EvaluationDefinitionProvenance;
    model?: string;
    requestedModel?: string;
    observedModels?: string[];
    durationMs: number;
    agentRetries?: number;
    stages?: {
        name?: string;
        gateCalled?: boolean;
        agentRun?: {
            outcome?: string;
            usage?: {
                inputTokens?: number;
                outputTokens?: number;
                reasoningTokens?: number;
                cacheReadTokens?: number;
                totalNanoAiu?: number;
                models?: string[];
            };
        };
        validation?: { valid?: boolean };
        buildValidation?: { outcome?: string };
        localRuntimeValidation?: {
            outcome?: string;
            browserChecks?: {
                success?: boolean;
                seriousAccessibilityViolations?: string[];
                accessibilityScanned?: boolean;
                accessibilityScanError?: string;
                qualityFailures?: {
                    stage: string;
                    code: string;
                    category: 'product_failure';
                    error: string;
                }[];
                consoleErrors?: string[];
                actionsCompleted?: number;
                actionsExpected?: number;
                assertionsCompleted?: number;
                assertionsExpected?: number;
            }[];
            persistenceChecks?: { success?: boolean }[];
            workerEvents?: { success?: boolean }[];
        };
    }[];
}

export interface EvaluationSummary {
    candidateCommit: string;
    agentAssetsHash: string;
    evaluationDefinitions?: EvaluationDefinitionProvenance[];
    through: string;
    evaluationArm?: string;
    requestedModel?: string;
    requestedModels?: string[];
    observedModels?: string[];
    results: EvaluationAttempt[];
}

export interface WilsonInterval {
    lower: number;
    upper: number;
}

interface RateSummary {
    attempts: number;
    successes: number;
    failures: number;
    rate: number | null;
    wilson95: WilsonInterval | null;
}

interface PairedOutcomeComparison {
    matchedAttempts: number;
    railsOnlyWins: number;
    baselineOnlyWins: number;
    bothPass: number;
    bothFail: number;
    candidateSuccess: RateSummary;
    baselineSuccess: RateSummary;
    successRateDelta: number | null;
    candidateFirstPass: RateSummary;
    baselineFirstPass: RateSummary;
    firstPassRateDelta: number | null;
    candidateRecoveredSuccesses: number;
    baselineRecoveredSuccesses: number;
    recoveredSuccessDelta: number;
}

interface PairedValueComparison {
    candidateTotal: number;
    baselineTotal: number;
    totalDelta: number;
    candidateAverage: number | null;
    baselineAverage: number | null;
    averageDelta: number | null;
}

interface ArmProvenance {
    expectedArm: 'rails' | 'baseline-controlled';
    declaredSummaries: number;
    legacySummaries: number;
    provenance: 'declared' | 'legacy_missing' | 'mixed_declared_and_legacy';
}

interface ArmModelProvenance {
    requestedModels: string[];
    observedModels: string[];
    missingRequestedAttempts: string[];
    missingObservedAttempts: string[];
    status: 'verified' | 'legacy_missing' | 'not_evaluated';
}

interface EvaluationDefinitionSummary {
    hashes: string[];
    scenarioCorpusHashes: string[];
    evaluatorHashes: string[];
    productContractHashes: string[];
    missingAttempts: string[];
    status: 'verified' | 'legacy_missing' | 'not_evaluated';
}

interface ProductQualityPairedComparison extends PairedOutcomeComparison {
    candidateExcludedAttempts: number;
    baselineExcludedAttempts: number;
    excludedPairs: number;
}

interface GroupedPairedComparison {
    allAutonomous: PairedOutcomeComparison;
    productQuality?: ProductQualityPairedComparison;
}

interface ModelOutcomeBreakdown {
    model: string;
    autonomousOutcome: RateSummary;
    firstPassOutcome: RateSummary;
    recoveredSuccesses: number;
    productQuality: RateSummary;
    excludedFromProductQuality: {
        harnessFailures: number;
        infrastructureFailures: number;
    };
    duration: EvaluationReport['duration'];
    usage: EvaluationReport['usage'];
}

interface PairedModelComparison extends GroupedPairedComparison {
    model: string;
    durationMs: PairedValueComparison;
    usage: NonNullable<EvaluationReport['baselineComparison']>['usage'];
}

export type ReleaseGateStatus = 'passed' | 'failed' | 'missing_evidence' | 'not_applicable';

export interface ReleaseGateResult {
    id: string;
    title: string;
    measuredValue: number | string | null;
    threshold: string;
    status: ReleaseGateStatus;
    rationale: string;
}

export interface EvaluationReport {
    schemaVersion: '1';
    generatedAt: string;
    candidateCommits: string[];
    agentAssetsHashes: string[];
    evaluationDefinitionProvenance: EvaluationDefinitionSummary;
    through: string[];
    autonomousOutcome: RateSummary;
    firstPassOutcome: RateSummary;
    recoveredSuccesses: number;
    productQuality: RateSummary;
    excludedFromProductQuality: {
        harnessFailures: number;
        infrastructureFailures: number;
    };
    byScenario: ({ scenarioId: string } & RateSummary)[];
    byModel: ModelOutcomeBreakdown[];
    byModelScenario: ({ scenarioId: string } & ModelOutcomeBreakdown)[];
    byTag: ({ tag: string; value: string } & RateSummary)[];
    stageJourney: ({ stage: string; firstPassSuccesses: number; recoveredSuccesses: number } & RateSummary)[];
    userJourneyDimensions: ({ dimension: string } & RateSummary)[];
    browserAcceptance: RateSummary & {
        interaction: RateSummary;
        accessibilityScans: number;
        accessibilityScanFailures: number;
        seriousAccessibilityViolations: number;
        consoleErrors: number;
    };
    vscodeParity: RateSummary & {
        runs: {
            outcome: SandboxVsCodeParityResult['outcome'];
            failureCode?: SandboxVsCodeParityResult['failureCode'];
            codeVersion?: string;
            configurationName?: string;
            source?: string;
            line?: number;
            column?: number;
            stoppedReason?: string;
            sourceProvenance?: SandboxVsCodeParityResult['sourceProvenance'];
        }[];
    };
    liveDeployment: RateSummary & {
        cleanupVerified: number;
        runs: Pick<LiveDeploymentResult, 'runId' | 'environmentName' | 'resourceGroup' | 'outcome' | 'cleanupVerified' | 'sourceProvenance' | 'error'>[];
    };
    evidenceCoverage: {
        corpusScenarios: number;
        evaluatedScenarios: number;
        scenariosWithThreeAttempts: number;
        expectedAttemptsAtThreePerScenario: number;
    };
    releaseAssessment: {
        recommendation: 'candidate' | 'hold' | 'insufficient_evidence';
        reasons: string[];
    };
    releaseGates?: {
        schemaVersion: '1';
        thresholdSchemaVersion: ReleaseThresholds['schemaVersion'];
        thresholdSet: string;
        results: ReleaseGateResult[];
    };
    failureCategories: Record<string, number>;
    failedStages: Record<string, number>;
    failureCodes: Record<string, number>;
    duration: {
        totalMs: number;
        averageMs: number;
    };
    usage: {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        cacheReadTokens: number;
        totalNanoAiu: number;
    };
    baselineComparison?: {
        matchedAttempts: number;
        unmatchedCandidateAttempts: number;
        unmatchedBaselineAttempts: number;
        improvements: number;
        regressions: number;
        unchangedPasses: number;
        unchangedFailures: number;
        candidateRate: number | null;
        baselineRate: number | null;
        delta: number | null;
        armProvenance: {
            candidate: ArmProvenance;
            baseline: ArmProvenance;
        };
        endpointProvenance: {
            candidate: string[];
            baseline: string[];
        };
        modelProvenance: {
            candidate: ArmModelProvenance;
            baseline: ArmModelProvenance;
            parity: 'verified' | 'legacy_missing' | 'not_evaluated';
        };
        evaluationDefinitionProvenance: {
            candidate: EvaluationDefinitionSummary;
            baseline: EvaluationDefinitionSummary;
            parity: 'verified' | 'legacy_missing' | 'not_evaluated';
        };
        allAutonomous: PairedOutcomeComparison;
        productQuality: ProductQualityPairedComparison;
        durationMs: PairedValueComparison;
        usage: {
            inputTokens: PairedValueComparison;
            outputTokens: PairedValueComparison;
            reasoningTokens: PairedValueComparison;
            cacheReadTokens: PairedValueComparison;
            totalNanoAiu: PairedValueComparison;
        };
        byScenario: ({ scenarioId: string } & GroupedPairedComparison)[];
        byModel: PairedModelComparison[];
        byTag: ({ tag: string; value: string } & GroupedPairedComparison)[];
    };
}

interface ReportOptions {
    inputs: string[];
    baselines: string[];
    vscodeParityInputs: string[];
    deploymentInputs: string[];
    thresholdsPath: string;
    outputDirectory: string;
}

export function wilsonInterval(successes: number, attempts: number): WilsonInterval | null {
    if (attempts === 0) {
        return null;
    }
    const z = 1.96;
    const proportion = successes / attempts;
    const denominator = 1 + z * z / attempts;
    const center = (proportion + z * z / (2 * attempts)) / denominator;
    const margin = z * Math.sqrt(
        proportion * (1 - proportion) / attempts + z * z / (4 * attempts * attempts),
    ) / denominator;
    return {
        lower: center - margin,
        upper: center + margin,
    };
}

export function classifyFailure(attempt: EvaluationAttempt): FailureCategory | undefined {
    if (attempt.outcome === 'autonomous_success') {
        return undefined;
    }
    if (attempt.failureCategory) {
        return attempt.failureCategory;
    }
    if (
        attempt.failedStage === 'harness'
        || [
            'acceptanceSpecMissing',
            'agentCleanupFailed',
            'attemptExecutionFailed',
            'harnessError',
            'modelMismatch',
            'modelNotObserved',
            'resultFinalizationFailed',
            'resultWriteFailed',
            'resumeHarnessError',
            'revalidationHarnessError',
        ].includes(attempt.failureCode ?? '')
    ) {
        return 'harness_failure';
    }
    if (
        isSandboxInfrastructureFailureCode(attempt.failureCode)
        || isLocalRuntimeInfrastructureFailureCode(attempt.failureCode)
        || isDeploymentInfrastructureFailureCode(attempt.failureCode)
    ) {
        return 'infrastructure_failure';
    }
    return 'product_failure';
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const scenarios = await loadScenarios(path.join(repoRoot, 'evals', 'scenarios'));
    const summaries = await loadSummaries(options.inputs);
    const baselineSummaries = options.baselines.length
        ? await loadSummaries(options.baselines)
        : [];
    const vscodeParityResults = await loadVsCodeParityResults(options.vscodeParityInputs);
    const deploymentResults = await loadDeploymentResults(options.deploymentInputs);
    const report = createReport(
        summaries,
        scenarios,
        baselineSummaries,
        vscodeParityResults,
        deploymentResults,
        loadReleaseThresholds(options.thresholdsPath),
    );
    await fs.mkdir(options.outputDirectory, { recursive: true });
    await Promise.all([
        fs.writeFile(
            path.join(options.outputDirectory, 'report.json'),
            JSON.stringify(report, null, 2) + '\n',
        ),
        fs.writeFile(path.join(options.outputDirectory, 'report.md'), renderMarkdown(report)),
    ]);
    process.stdout.write(`Report: ${options.outputDirectory}\n`);
}

export function createReport(
    summaries: EvaluationSummary[],
    scenarios: CorEvaluationScenario[],
    baselineSummaries: EvaluationSummary[],
    vscodeParityResults: SandboxVsCodeParityResult[] = [],
    deploymentResults: LiveDeploymentResult[] = [],
    thresholds: ReleaseThresholds = loadReleaseThresholds(),
): EvaluationReport {
    const attempts = summaries.flatMap(summary => summary.results);
    const baselineAttempts = baselineSummaries.flatMap(summary => summary.results);
    const candidateSummaryByAttempt = summaryByAttempt(summaries);
    const armProvenance = validateEvaluationArms(summaries, baselineSummaries);
    assertUniqueRunIds(attempts);
    assertUniqueRunIds(baselineAttempts);
    const scenarioMap = new Map(scenarios.map(scenario => [scenario.id, scenario]));
    validateVsCodeParitySources(vscodeParityResults, summaries, scenarioMap);
    validateDeploymentSources(deploymentResults, summaries);
    for (const attempt of [...attempts, ...baselineAttempts]) {
        if (!scenarioMap.has(attempt.scenarioId)) {
            throw new Error(`Report input references unknown scenario "${attempt.scenarioId}".`);
        }
    }

    const categories = new Map(attempts.map(attempt => [attempt.runId, classifyFailure(attempt)]));
    const productAttempts = attempts.filter(attempt => {
        const category = categories.get(attempt.runId);
        return category !== 'harness_failure' && category !== 'infrastructure_failure';
    });
    const report: EvaluationReport = {
        schemaVersion: '1',
        generatedAt: new Date().toISOString(),
        candidateCommits: unique(summaries.map(summary => summary.candidateCommit)),
        agentAssetsHashes: unique(summaries.map(summary => summary.agentAssetsHash)),
        evaluationDefinitionProvenance: summarizeEvaluationDefinitions(summaries),
        through: unique(summaries.map(summary => summary.through)),
        autonomousOutcome: summarizeRate(attempts),
        firstPassOutcome: summarizeFirstPassRate(attempts),
        recoveredSuccesses: attempts.filter(attempt =>
            attempt.outcome === 'autonomous_success' && (attempt.agentRetries ?? 0) > 0).length,
        productQuality: summarizeRate(productAttempts),
        excludedFromProductQuality: {
            harnessFailures: attempts.filter(attempt => categories.get(attempt.runId) === 'harness_failure').length,
            infrastructureFailures: attempts.filter(attempt => categories.get(attempt.runId) === 'infrastructure_failure').length,
        },
        byScenario: unique(attempts.map(attempt => attempt.scenarioId))
            .map(scenarioId => ({
                scenarioId,
                ...summarizeRate(productAttempts.filter(attempt => attempt.scenarioId === scenarioId)),
            })),
        byModel: createModelBreakdown(
            attempts,
            productAttempts,
            categories,
            candidateSummaryByAttempt,
        ),
        byModelScenario: createModelScenarioBreakdown(
            attempts,
            productAttempts,
            categories,
            candidateSummaryByAttempt,
        ),
        byTag: createTagRates(attempts, productAttempts, scenarioMap),
        stageJourney: createStageJourney(attempts),
        userJourneyDimensions: createUserJourneyDimensions(attempts),
        browserAcceptance: createBrowserAcceptance(attempts),
        vscodeParity: createVsCodeParitySummary(vscodeParityResults),
        liveDeployment: createLiveDeploymentSummary(deploymentResults),
        evidenceCoverage: createEvidenceCoverage(attempts, scenarios),
        releaseAssessment: createReleaseAssessment(
            attempts,
            scenarios,
            categories,
            vscodeParityResults,
            deploymentResults,
        ),
        failureCategories: countValues(
            attempts.map(attempt => categories.get(attempt.runId)).filter(value => value !== undefined),
        ),
        failedStages: countValues(
            attempts.filter(attempt => attempt.outcome === 'failed').map(attempt => attempt.failedStage ?? 'unknown'),
        ),
        failureCodes: countValues(
            attempts.filter(attempt => attempt.outcome === 'failed').map(attempt => attempt.failureCode ?? 'unknown'),
        ),
        duration: {
            totalMs: attempts.reduce((total, attempt) => total + attempt.durationMs, 0),
            averageMs: attempts.length
                ? attempts.reduce((total, attempt) => total + attempt.durationMs, 0) / attempts.length
                : 0,
        },
        usage: sumUsage(attempts),
    };
    if (baselineSummaries.length) {
        report.baselineComparison = compareBaseline(
            summaries,
            baselineSummaries,
            scenarioMap,
            armProvenance,
        );
    }
    report.releaseGates = evaluateReleaseGates(
        report,
        summaries,
        scenarios,
        baselineSummaries,
        vscodeParityResults,
        deploymentResults,
        thresholds,
    );
    report.releaseAssessment = releaseAssessmentFromGates(report.releaseGates.results);
    return report;
}

function validateEvaluationArms(
    candidate: EvaluationSummary[],
    baseline: EvaluationSummary[],
): NonNullable<EvaluationReport['baselineComparison']>['armProvenance'] {
    const invalidCandidate = candidate.find(summary =>
        summary.evaluationArm !== undefined && summary.evaluationArm !== 'rails');
    if (invalidCandidate) {
        throw new Error(
            `Candidate report inputs must use evaluationArm "rails"; found "${invalidCandidate.evaluationArm}".`,
        );
    }
    const invalidBaseline = baseline.find(summary =>
        summary.evaluationArm !== undefined && summary.evaluationArm !== 'baseline-controlled');
    if (invalidBaseline) {
        throw new Error(
            `Baseline report inputs must use evaluationArm "baseline-controlled"; found "${invalidBaseline.evaluationArm}".`,
        );
    }
    validateAttemptArms(candidate, 'rails', 'Candidate');
    validateAttemptArms(baseline, 'baseline-controlled', 'Baseline');
    return {
        candidate: summarizeArmProvenance(candidate, 'rails'),
        baseline: summarizeArmProvenance(baseline, 'baseline-controlled'),
    };
}

function validateAttemptArms(
    summaries: EvaluationSummary[],
    expectedArm: NonNullable<EvaluationAttempt['evaluationArm']>,
    label: string,
): void {
    for (const summary of summaries) {
        for (const attempt of summary.results) {
            if (attempt.evaluationArm !== undefined && attempt.evaluationArm !== expectedArm) {
                throw new Error(
                    `${label} attempt "${attempt.runId}" must use evaluationArm "${expectedArm}"; `
                    + `found "${attempt.evaluationArm}".`,
                );
            }
            if (summary.evaluationArm === expectedArm && attempt.evaluationArm === undefined) {
                throw new Error(
                    `${label} attempt "${attempt.runId}" is missing evaluationArm under a declared "${expectedArm}" summary.`,
                );
            }
        }
    }
}

function summarizeArmProvenance(
    summaries: EvaluationSummary[],
    expectedArm: ArmProvenance['expectedArm'],
): ArmProvenance {
    const declaredSummaries = summaries.filter(summary => summary.evaluationArm === expectedArm).length;
    const legacySummaries = summaries.length - declaredSummaries;
    return {
        expectedArm,
        declaredSummaries,
        legacySummaries,
        provenance: declaredSummaries && legacySummaries
            ? 'mixed_declared_and_legacy'
            : legacySummaries
                ? 'legacy_missing'
                : 'declared',
    };
}

function summarizeRate(attempts: EvaluationAttempt[]): RateSummary {
    const successes = attempts.filter(attempt => attempt.outcome === 'autonomous_success').length;
    return {
        attempts: attempts.length,
        successes,
        failures: attempts.length - successes,
        rate: attempts.length ? successes / attempts.length : null,
        wilson95: wilsonInterval(successes, attempts.length),
    };
}

function summarizeFirstPassRate(attempts: EvaluationAttempt[]): RateSummary {
    const successes = attempts.filter(attempt =>
        attempt.outcome === 'autonomous_success' && (attempt.agentRetries ?? 0) === 0).length;
    return {
        attempts: attempts.length,
        successes,
        failures: attempts.length - successes,
        rate: attempts.length ? successes / attempts.length : null,
        wilson95: wilsonInterval(successes, attempts.length),
    };
}

function createModelBreakdown(
    attempts: EvaluationAttempt[],
    productAttempts: EvaluationAttempt[],
    categories: Map<string, FailureCategory | undefined>,
    summaries: Map<EvaluationAttempt, EvaluationSummary>,
): ModelOutcomeBreakdown[] {
    const productRunIds = new Set(productAttempts.map(attempt => attempt.runId));
    const grouped = new Map<string, EvaluationAttempt[]>();
    for (const attempt of attempts) {
        const model = reportModel(attempt, summaries.get(attempt));
        grouped.set(model, [...(grouped.get(model) ?? []), attempt]);
    }
    return [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([model, modelAttempts]) => summarizeModelOutcomes(
            model,
            modelAttempts,
            modelAttempts.filter(attempt => productRunIds.has(attempt.runId)),
            categories,
        ));
}

function createModelScenarioBreakdown(
    attempts: EvaluationAttempt[],
    productAttempts: EvaluationAttempt[],
    categories: Map<string, FailureCategory | undefined>,
    summaries: Map<EvaluationAttempt, EvaluationSummary>,
): EvaluationReport['byModelScenario'] {
    const productRunIds = new Set(productAttempts.map(attempt => attempt.runId));
    const grouped = new Map<string, { model: string; scenarioId: string; attempts: EvaluationAttempt[] }>();
    for (const attempt of attempts) {
        const model = reportModel(attempt, summaries.get(attempt));
        const key = `${model}\0${attempt.scenarioId}`;
        const value = grouped.get(key) ?? { model, scenarioId: attempt.scenarioId, attempts: [] };
        value.attempts.push(attempt);
        grouped.set(key, value);
    }
    return [...grouped.values()]
        .sort((left, right) =>
            left.model.localeCompare(right.model) || left.scenarioId.localeCompare(right.scenarioId))
        .map(value => ({
            scenarioId: value.scenarioId,
            ...summarizeModelOutcomes(
                value.model,
                value.attempts,
                value.attempts.filter(attempt => productRunIds.has(attempt.runId)),
                categories,
            ),
        }));
}

function summarizeModelOutcomes(
    model: string,
    attempts: EvaluationAttempt[],
    productAttempts: EvaluationAttempt[],
    categories: Map<string, FailureCategory | undefined>,
): ModelOutcomeBreakdown {
    const totalMs = attempts.reduce((total, attempt) => total + attempt.durationMs, 0);
    return {
        model,
        autonomousOutcome: summarizeRate(attempts),
        firstPassOutcome: summarizeFirstPassRate(attempts),
        recoveredSuccesses: attempts.filter(recovered).length,
        productQuality: summarizeRate(productAttempts),
        excludedFromProductQuality: {
            harnessFailures: attempts.filter(attempt =>
                categories.get(attempt.runId) === 'harness_failure').length,
            infrastructureFailures: attempts.filter(attempt =>
                categories.get(attempt.runId) === 'infrastructure_failure').length,
        },
        duration: {
            totalMs,
            averageMs: attempts.length ? totalMs / attempts.length : 0,
        },
        usage: sumUsage(attempts),
    };
}

function createTagRates(
    allAttempts: EvaluationAttempt[],
    productAttempts: EvaluationAttempt[],
    scenarios: Map<string, CorEvaluationScenario>,
): ({ tag: string; value: string } & RateSummary)[] {
    const allTaggedAttempts = allAttempts.flatMap(attempt =>
        Object.entries(scenarios.get(attempt.scenarioId)?.tags ?? {})
            .map(([tag, value]) => ({ tag, value, attempt })));
    const productRunIds = new Set(productAttempts.map(attempt => attempt.runId));
    const keys = unique(allTaggedAttempts.map(value => `${value.tag}\0${value.value}`)).sort();
    return keys.map(key => {
        const [tag, value] = key.split('\0');
        const values = allTaggedAttempts
            .filter(candidate =>
                candidate.tag === tag
                && candidate.value === value
                && productRunIds.has(candidate.attempt.runId))
            .map(candidate => candidate.attempt);
        return { tag, value, ...summarizeRate(values) };
    });
}

const journeyStages = [
    'requirements',
    'plan',
    'scaffold',
    'build',
    'integration',
    'integration-build',
    'debug-plan',
    'debug-generate',
    'local-artifacts',
    'local-runtime',
];

function createStageJourney(attempts: EvaluationAttempt[]): EvaluationReport['stageJourney'] {
    return journeyStages.flatMap(stage => {
        const attempted = attempts.filter(attempt => attempt.stages?.some(value => value.name === stage));
        if (!attempted.length) {
            return [];
        }
        const outcomes = attempted.map(attempt => {
            const matching = attempt.stages?.filter(value => value.name === stage) ?? [];
            return {
                firstPass: stagePassed(matching[0]),
                finalPass: stagePassed(matching[matching.length - 1]),
            };
        });
        const successes = outcomes.filter(value => value.finalPass).length;
        return [{
            stage,
            attempts: attempted.length,
            successes,
            failures: attempted.length - successes,
            rate: successes / attempted.length,
            wilson95: wilsonInterval(successes, attempted.length),
            firstPassSuccesses: outcomes.filter(value => value.firstPass).length,
            recoveredSuccesses: outcomes.filter(value => !value.firstPass && value.finalPass).length,
        }];
    });
}

function createUserJourneyDimensions(attempts: EvaluationAttempt[]): EvaluationReport['userJourneyDimensions'] {
    const dimensions = [
        { dimension: 'Requirements and architecture', stages: ['requirements', 'plan'] },
        { dimension: 'Generated project quality', stages: ['scaffold', 'build'] },
        { dimension: 'Application integration', stages: ['integration', 'integration-build'] },
        { dimension: 'Local debugging experience', stages: ['debug-plan', 'debug-generate', 'local-artifacts', 'local-runtime'] },
    ];
    const stageDimensions = dimensions.flatMap(({ dimension, stages }) => {
        const attempted = attempts.filter(attempt => attempt.stages?.some(stage => stage.name === stages[0]));
        if (!attempted.length) {
            return [];
        }

        const successes = attempted.filter(attempt =>
            stages.every(stage => finalStagePassed(attempt, stage))).length;
        return [{
            dimension,
            attempts: attempted.length,
            successes,
            failures: attempted.length - successes,
            rate: successes / attempted.length,
            wilson95: wilsonInterval(successes, attempted.length),
        }];
    });
    const localValidations = attempts.flatMap(attempt => {
        const localStages = attempt.stages?.filter(stage => stage.name === 'local-runtime') ?? [];
        const validation = localStages[localStages.length - 1]?.localRuntimeValidation;
        return validation ? [validation] : [];
    });
    const evidenceDimensions = [
        {
            dimension: 'Durable application persistence',
            checks: localValidations.flatMap(validation => validation.persistenceChecks ?? []),
        },
        {
            dimension: 'Worker storage events',
            checks: localValidations.flatMap(validation => validation.workerEvents ?? []),
        },
    ].flatMap(({ dimension, checks }) => {
        if (!checks.length) {
            return [];
        }
        const successes = checks.filter(check => check.success === true).length;
        return [{
            dimension,
            ...summarizeCounts(successes, checks.length),
        }];
    });
    return [...stageDimensions, ...evidenceDimensions];
}

function createBrowserAcceptance(attempts: EvaluationAttempt[]): EvaluationReport['browserAcceptance'] {
    const checks = attempts.flatMap(attempt => {
        const localStages = attempt.stages?.filter(stage => stage.name === 'local-runtime') ?? [];
        return localStages[localStages.length - 1]?.localRuntimeValidation?.browserChecks ?? [];
    });
    const successes = checks.filter(check => check.success).length;
    const interactionChecks = checks.filter(check =>
        (check.actionsExpected ?? 0) > 0 || (check.assertionsExpected ?? 0) > 0);
    const interactionSuccesses = interactionChecks.filter(check =>
        check.actionsCompleted === check.actionsExpected
        && check.assertionsCompleted === check.assertionsExpected).length;
    return {
        attempts: checks.length,
        successes,
        failures: checks.length - successes,
        rate: checks.length ? successes / checks.length : null,
        wilson95: wilsonInterval(successes, checks.length),
        interaction: summarizeCounts(interactionSuccesses, interactionChecks.length),
        accessibilityScans: checks.filter(check => check.accessibilityScanned).length,
        accessibilityScanFailures: checks.filter(check => !!check.accessibilityScanError).length,
        seriousAccessibilityViolations: checks.reduce(
            (total, check) => total + (check.seriousAccessibilityViolations?.length ?? 0),
            0,
        ),
        consoleErrors: checks.reduce((total, check) => total + (check.consoleErrors?.length ?? 0), 0),
    };
}

function createVsCodeParitySummary(
    results: SandboxVsCodeParityResult[],
): EvaluationReport['vscodeParity'] {
    const attempted = results.filter(result => result.outcome !== 'skipped');
    const successes = attempted.filter(result => result.outcome === 'passed').length;
    return {
        ...summarizeCounts(successes, attempted.length),
        runs: results.map(result => ({
            outcome: result.outcome,
            failureCode: result.failureCode,
            codeVersion: result.codeVersion,
            configurationName: result.evidence?.configurationName,
            source: result.evidence?.source,
            line: result.evidence?.line,
            column: result.evidence?.column,
            stoppedReason: result.evidence?.stoppedReason,
            sourceProvenance: result.sourceProvenance,
        })),
    };
}

function createLiveDeploymentSummary(
    results: LiveDeploymentResult[],
): EvaluationReport['liveDeployment'] {
    const successes = results.filter(result => result.outcome === 'passed' && result.cleanupVerified).length;
    return {
        ...summarizeCounts(successes, results.length),
        cleanupVerified: results.filter(result => result.cleanupVerified).length,
        runs: results.map(result => ({
            runId: result.runId,
            environmentName: result.environmentName,
            resourceGroup: result.resourceGroup,
            outcome: result.outcome,
            cleanupVerified: result.cleanupVerified,
            sourceProvenance: result.sourceProvenance,
            error: result.error,
        })),
    };
}

function finalStagePassed(attempt: EvaluationAttempt, name: string): boolean {
    const matching = attempt.stages?.filter(stage => stage.name === name) ?? [];
    return stagePassed(matching[matching.length - 1]);
}

function stagePassed(stage: NonNullable<EvaluationAttempt['stages']>[number] | undefined): boolean {
    if (!stage) {
        return false;
    }
    if (stage.localRuntimeValidation) {
        return stage.localRuntimeValidation.outcome === 'passed';
    }
    if (stage.buildValidation) {
        return stage.buildValidation.outcome === 'passed';
    }
    if (stage.validation && stage.validation.valid !== true) {
        return false;
    }
    if (stage.agentRun && stage.agentRun.outcome !== 'completed') {
        return false;
    }
    if (stage.gateCalled === false) {
        return false;
    }
    return !!stage.validation || !!stage.agentRun;
}

function createEvidenceCoverage(
    attempts: EvaluationAttempt[],
    scenarios: CorEvaluationScenario[],
): EvaluationReport['evidenceCoverage'] {
    const attemptCounts = new Map<string, number>();
    for (const attempt of attempts) {
        attemptCounts.set(attempt.scenarioId, (attemptCounts.get(attempt.scenarioId) ?? 0) + 1);
    }
    return {
        corpusScenarios: scenarios.length,
        evaluatedScenarios: attemptCounts.size,
        scenariosWithThreeAttempts: [...attemptCounts.values()].filter(count => count >= 3).length,
        expectedAttemptsAtThreePerScenario: scenarios.length * 3,
    };
}

function createReleaseAssessment(
    attempts: EvaluationAttempt[],
    scenarios: CorEvaluationScenario[],
    categories: Map<string, FailureCategory | undefined>,
    vscodeParityResults: SandboxVsCodeParityResult[],
    deploymentResults: LiveDeploymentResult[],
): EvaluationReport['releaseAssessment'] {
    const coverage = createEvidenceCoverage(attempts, scenarios);
    const reasons: string[] = [];
    if (coverage.evaluatedScenarios < coverage.corpusScenarios) {
        reasons.push(`Only ${coverage.evaluatedScenarios}/${coverage.corpusScenarios} corpus scenarios have evidence.`);
    }
    if (coverage.scenariosWithThreeAttempts < coverage.corpusScenarios) {
        reasons.push(`Only ${coverage.scenariosWithThreeAttempts}/${coverage.corpusScenarios} scenarios have at least three repetitions.`);
    }
    const successfulDeployment = deploymentResults.some(result =>
        result.outcome === 'passed' && result.cleanupVerified);
    if (!successfulDeployment) {
        reasons.push('No live-deployment acceptance evidence is present.');
    }
    const parityAttempts = vscodeParityResults.filter(result => result.outcome !== 'skipped');
    if (!parityAttempts.length) {
        reasons.push('No real VS Code F5/breakpoint parity evidence is present.');
    } else if (parityAttempts.some(result => result.outcome !== 'passed')) {
        reasons.push('One or more real VS Code F5/breakpoint parity checks failed.');
    }
    const excludedFailures = attempts.filter(attempt => {
        const category = categories.get(attempt.runId);
        return category === 'harness_failure' || category === 'infrastructure_failure';
    }).length;
    if (excludedFailures) {
        reasons.push(`${excludedFailures} harness or infrastructure failure(s) require resolution.`);
    }
    const productFailures = attempts.filter(attempt => categories.get(attempt.runId) === 'product_failure').length;
    if (productFailures) {
        reasons.push(`${productFailures} product-quality attempt(s) failed.`);
    }
    const insufficient = coverage.evaluatedScenarios < coverage.corpusScenarios
        || coverage.scenariosWithThreeAttempts < coverage.corpusScenarios
        || !successfulDeployment
        || !parityAttempts.length;
    return {
        recommendation: insufficient
            ? 'insufficient_evidence'
            : productFailures || excludedFailures || parityAttempts.some(result => result.outcome !== 'passed')
                ? 'hold'
                : 'candidate',
        reasons: reasons.length ? reasons : ['All configured evidence gates passed.'],
    };
}

export function evaluateReleaseGates(
    report: EvaluationReport,
    summaries: EvaluationSummary[],
    scenarios: CorEvaluationScenario[],
    baselineSummaries: EvaluationSummary[],
    vscodeParityResults: SandboxVsCodeParityResult[],
    deploymentResults: LiveDeploymentResult[],
    thresholds: ReleaseThresholds,
): NonNullable<EvaluationReport['releaseGates']> {
    const attempts = summaries.flatMap(summary => summary.results);
    const allAttempts = [...attempts, ...baselineSummaries.flatMap(summary => summary.results)];
    const summaryMap = summaryByAttempt(summaries);
    const models = unique(attempts.map(attempt => reportModel(attempt, summaryMap.get(attempt))));
    const results: ReleaseGateResult[] = [];
    const add = (
        id: string,
        title: string,
        measuredValue: ReleaseGateResult['measuredValue'],
        threshold: string,
        status: ReleaseGateStatus,
        rationale: string,
    ): void => {
        results.push({ id, title, measuredValue, threshold, status, rationale });
    };

    const criticalCodes = new Set(thresholds.criticalFailures.failureCodes);
    const criticalFailures = allAttempts.filter(attempt =>
        criticalCodes.has(attempt.failureCode ?? '')
        || /critical.*security|security.*critical|destructive/i.test(attempt.failureCode ?? ''));
    add(
        'critical-failures',
        'Critical security/destructive failures',
        attempts.length ? String(criticalFailures.length) : null,
        `≤ ${thresholds.criticalFailures.maximumCount}`,
        !attempts.length
            ? 'missing_evidence'
            : criticalFailures.length <= thresholds.criticalFailures.maximumCount ? 'passed' : 'failed',
        !attempts.length
            ? 'No evaluator attempts are present.'
            : criticalFailures.length
                ? `Critical failure codes: ${criticalFailures.map(value => value.failureCode).join(', ')}.`
                : 'No configured critical security, destructive-operation, or cleanup failure code was observed.',
    );

    const evaluatedScenarioIds = new Set(attempts.map(attempt => attempt.scenarioId));
    const scenarioCoverage = scenarios.length ? evaluatedScenarioIds.size / scenarios.length : null;
    addRateGate(
        add,
        'scenario-coverage',
        'Scenario evidence coverage',
        scenarioCoverage,
        thresholds.evidence.minimumScenarioCoverage,
        scenarios.length > 0,
        `${evaluatedScenarioIds.size}/${scenarios.length} corpus scenarios have candidate evidence.`,
    );

    const repetitionCounts = new Map<string, number>();
    for (const attempt of attempts) {
        const model = reportModel(attempt, summaryMap.get(attempt));
        const key = `${model}\0${attempt.scenarioId}`;
        repetitionCounts.set(key, (repetitionCounts.get(key) ?? 0) + 1);
    }
    const expectedRepetitionGroups = models.flatMap(model =>
        scenarios.map(scenario => ({ model, scenarioId: scenario.id })));
    const insufficientRepetitionGroups = expectedRepetitionGroups.filter(value =>
        (repetitionCounts.get(`${value.model}\0${value.scenarioId}`) ?? 0)
            < thresholds.evidence.minimumAttemptsPerModelScenario);
    add(
        'model-scenario-repetitions',
        'Per-model scenario repetitions',
        expectedRepetitionGroups.length
            ? String(expectedRepetitionGroups.length - insufficientRepetitionGroups.length)
            : null,
        `${thresholds.evidence.minimumAttemptsPerModelScenario} attempts for every model + scenario`,
        !expectedRepetitionGroups.length
            ? 'missing_evidence'
            : insufficientRepetitionGroups.length ? 'missing_evidence' : 'passed',
        !expectedRepetitionGroups.length
            ? 'No model-attributed attempts are present.'
            : insufficientRepetitionGroups.length
                ? `${insufficientRepetitionGroups.length}/${expectedRepetitionGroups.length} model-scenario groups are below the repetition minimum.`
                : `All ${expectedRepetitionGroups.length} model-scenario groups meet the repetition minimum.`,
    );

    addModelRateGate(
        add,
        'final-success',
        'Final autonomous success',
        report.byModel.map(value => ({ model: value.model, value: value.autonomousOutcome.rate })),
        thresholds.outcomes.minimumFinalSuccessRate,
    );
    addModelRateGate(
        add,
        'first-pass-success',
        'First-pass success',
        report.byModel.map(value => ({ model: value.model, value: value.firstPassOutcome.rate })),
        thresholds.outcomes.minimumFirstPassSuccessRate,
    );

    const uiScenarioIds = new Set(scenarios
        .filter(scenario => scenario.acceptance?.local?.probes.some(probe => probe.browser))
        .map(scenario => scenario.id));
    const uiChecks = finalLocalValidations(attempts)
        .filter(value => uiScenarioIds.has(value.attempt.scenarioId))
        .flatMap(value => value.validation.browserChecks ?? []);
    const uiScenarioMap = new Map(scenarios.map(scenario => [scenario.id, scenario]));
    const expectedUiChecks = attempts
        .filter(attempt => uiScenarioIds.has(attempt.scenarioId))
        .reduce((total, attempt) => total + (
            uiScenarioMap.get(attempt.scenarioId)?.acceptance?.local?.probes
                .filter(probe => probe.browser).length ?? 0
        ), 0);
    addApplicableRateGate(
        add,
        'ui-browser',
        'UI browser acceptance',
        uiScenarioIds.size > 0,
        uiChecks.filter(check => check.success === true).length,
        uiChecks.length,
        thresholds.ui.minimumBrowserSuccessRate,
        expectedUiChecks,
    );
    const completedAccessibilityScans = uiChecks.filter(check =>
        check.accessibilityScanned === true && !check.accessibilityScanError).length;
    const accessibilityCoverage = expectedUiChecks
        ? completedAccessibilityScans / expectedUiChecks
        : null;
    add(
        'ui-accessibility-scans',
        'UI accessibility scan coverage',
        accessibilityCoverage,
        `≥ ${formatPercent(thresholds.ui.minimumAccessibilityScanCoverage)}`,
        !uiScenarioIds.size
            ? 'not_applicable'
            : accessibilityCoverage === null || uiChecks.length < expectedUiChecks
                ? 'missing_evidence'
                : accessibilityCoverage >= thresholds.ui.minimumAccessibilityScanCoverage ? 'passed' : 'missing_evidence',
        !uiScenarioIds.size
            ? 'No scenario declares a browser acceptance contract.'
            : `${completedAccessibilityScans}/${expectedUiChecks} expected browser checks have completed accessibility scans.`,
    );
    const accessibilityViolations = uiChecks.reduce(
        (total, check) => total + (check.seriousAccessibilityViolations?.length ?? 0),
        0,
    );
    add(
        'ui-accessibility-violations',
        'Serious/critical accessibility violations',
        !uiScenarioIds.size || !uiChecks.length ? null : String(accessibilityViolations),
        `≤ ${thresholds.ui.maximumSeriousOrCriticalViolations}`,
        !uiScenarioIds.size
            ? 'not_applicable'
            : !uiChecks.length
                || uiChecks.length < expectedUiChecks
                || completedAccessibilityScans < expectedUiChecks
                ? 'missing_evidence'
                : accessibilityViolations <= thresholds.ui.maximumSeriousOrCriticalViolations ? 'passed' : 'failed',
        !uiScenarioIds.size
            ? 'No scenario declares a browser acceptance contract.'
            : !uiChecks.length
                ? 'Required UI accessibility evidence is absent.'
                : `${accessibilityViolations} serious/critical violation(s) were retained.`,
    );

    addScenarioCheckGate(
        add,
        'persistence',
        'Persistence after process restart',
        scenarios.filter(scenario =>
            scenario.acceptance?.local?.probes.some(probe => probe.browser?.persistence)).map(value => value.id),
        finalLocalValidations(attempts).flatMap(value => value.validation.persistenceChecks ?? []),
        thresholds.sideEffects.minimumPersistenceSuccessRate,
        attempts.reduce((total, attempt) => total + (
            uiScenarioMap.get(attempt.scenarioId)?.acceptance?.local?.probes
                .filter(probe => probe.browser?.persistence).length ?? 0
        ), 0),
    );
    addScenarioCheckGate(
        add,
        'worker-side-effects',
        'Worker side-effect oracle',
        scenarios.filter(scenario =>
            (scenario.acceptance?.local?.storageEvents?.length ?? 0) > 0).map(value => value.id),
        finalLocalValidations(attempts).flatMap(value => value.validation.workerEvents ?? []),
        thresholds.sideEffects.minimumWorkerSuccessRate,
        attempts.reduce((total, attempt) => total + (
            uiScenarioMap.get(attempt.scenarioId)?.acceptance?.local?.storageEvents?.length ?? 0
        ), 0),
    );

    const debuggerApplicable = scenarios.some(scenario => !!scenario.acceptance?.local?.debugParity);
    const debuggerAttempts = vscodeParityResults.filter(result => result.outcome !== 'skipped');
    const debuggerRate = debuggerAttempts.length
        ? debuggerAttempts.filter(result => result.outcome === 'passed').length / debuggerAttempts.length
        : null;
    add(
        'debugger-evidence',
        'VS Code F5/breakpoint evidence',
        debuggerRate,
        `≥ ${thresholds.debugger.minimumRuns} run(s), success ≥ ${formatPercent(thresholds.debugger.minimumSuccessRate)}`,
        !debuggerApplicable
            ? 'not_applicable'
            : debuggerAttempts.length < thresholds.debugger.minimumRuns
                ? 'missing_evidence'
                : (debuggerRate ?? 0) >= thresholds.debugger.minimumSuccessRate ? 'passed' : 'failed',
        !debuggerApplicable
            ? 'No scenario declares a debug parity contract.'
            : `${debuggerAttempts.length} provenance-bound debugger run(s) were supplied.`,
    );

    const deploymentRate = deploymentResults.length
        ? deploymentResults.filter(result => result.outcome === 'passed' && result.cleanupVerified).length
            / deploymentResults.length
        : null;
    const deploymentCleanupCoverage = deploymentResults.length
        ? deploymentResults.filter(result => result.cleanupVerified).length / deploymentResults.length
        : null;
    add(
        'deployment-evidence',
        'Live deployment acceptance',
        deploymentRate,
        `≥ ${thresholds.deployment.minimumRuns} run(s), success ≥ ${formatPercent(thresholds.deployment.minimumSuccessRate)}`,
        deploymentResults.length < thresholds.deployment.minimumRuns
            ? 'missing_evidence'
            : (deploymentRate ?? 0) >= thresholds.deployment.minimumSuccessRate ? 'passed' : 'failed',
        `${deploymentResults.length} provenance-bound deployment run(s) were supplied.`,
    );
    add(
        'deployment-cleanup',
        'Deployment cleanup verification',
        deploymentCleanupCoverage,
        `≥ ${formatPercent(thresholds.deployment.minimumCleanupCoverage)}`,
        !deploymentResults.length
            ? 'missing_evidence'
            : (deploymentCleanupCoverage ?? 0) >= thresholds.deployment.minimumCleanupCoverage ? 'passed' : 'failed',
        `${deploymentResults.filter(result => result.cleanupVerified).length}/${deploymentResults.length} deployments verified cleanup.`,
    );

    const definitionStatus = report.evaluationDefinitionProvenance.status;
    const pairedDefinitionStatus = report.baselineComparison?.evaluationDefinitionProvenance.parity;
    const definitionVerified = definitionStatus === 'verified'
        && (!thresholds.baseline.required || pairedDefinitionStatus === 'verified');
    const definitionRequired = thresholds.provenance.requireEvaluationDefinitionHash;
    add(
        'evaluation-definition-provenance',
        'Evaluation definition provenance',
        report.evaluationDefinitionProvenance.hashes.length
            ? `Rails=${report.evaluationDefinitionProvenance.hashes.join(', ')}; baseline=${
                report.baselineComparison?.evaluationDefinitionProvenance.baseline.hashes.join(', ') || 'missing'
            }`
            : null,
        'modern scenario-corpus + evaluator + product-contract hashes on every attempt; exact paired parity',
        !definitionRequired
            ? 'not_applicable'
            : definitionVerified ? 'passed' : 'missing_evidence',
        !definitionRequired
            ? 'The selected threshold set does not require modern evaluation-definition provenance.'
            : `Candidate=${definitionStatus}; paired=${pairedDefinitionStatus ?? 'not_evaluated'}; `
                + `missing candidate attempts=${report.evaluationDefinitionProvenance.missingAttempts.length}.`,
    );

    addBaselineGates(add, report, summaries, baselineSummaries, scenarios, thresholds);
    addProvenanceGate(add, summaries, baselineSummaries, thresholds, criticalCodes);

    return {
        schemaVersion: '1',
        thresholdSchemaVersion: thresholds.schemaVersion,
        thresholdSet: thresholds.thresholdSet,
        results,
    };
}

type AddReleaseGate = (
    id: string,
    title: string,
    measuredValue: ReleaseGateResult['measuredValue'],
    threshold: string,
    status: ReleaseGateStatus,
    rationale: string,
) => void;

function addRateGate(
    add: AddReleaseGate,
    id: string,
    title: string,
    value: number | null,
    threshold: number,
    evidencePresent: boolean,
    rationale: string,
): void {
    add(
        id,
        title,
        value,
        `≥ ${formatPercent(threshold)}`,
        !evidencePresent || value === null ? 'missing_evidence' : value >= threshold ? 'passed' : 'failed',
        rationale,
    );
}

function addModelRateGate(
    add: AddReleaseGate,
    id: string,
    title: string,
    values: { model: string; value: number | null }[],
    threshold: number,
): void {
    const missing = values.filter(value => value.value === null);
    const failing = values.filter(value => value.value !== null && value.value < threshold);
    add(
        id,
        title,
        values.length ? values.map(value => `${value.model}=${formatPercent(value.value)}`).join('; ') : null,
        `every model ≥ ${formatPercent(threshold)}`,
        !values.length || missing.length ? 'missing_evidence' : failing.length ? 'failed' : 'passed',
        !values.length
            ? 'No model-attributed outcomes are present.'
            : failing.length
                ? `Below threshold: ${failing.map(value => value.model).join(', ')}.`
                : 'Every evaluated model meets the threshold.',
    );
}

function addApplicableRateGate(
    add: AddReleaseGate,
    id: string,
    title: string,
    applicable: boolean,
    successes: number,
    attempts: number,
    threshold: number,
    expectedAttempts = attempts,
): void {
    const value = attempts ? successes / attempts : null;
    add(
        id,
        title,
        value,
        `≥ ${formatPercent(threshold)}`,
        !applicable
            ? 'not_applicable'
            : value === null || attempts < expectedAttempts
                ? 'missing_evidence'
                : value >= threshold ? 'passed' : 'failed',
        !applicable
            ? 'No scenario declares this evidence contract.'
            : `${successes}/${attempts} applicable checks passed; ${expectedAttempts} evidence record(s) expected.`,
    );
}

function addScenarioCheckGate(
    add: AddReleaseGate,
    id: string,
    title: string,
    applicableScenarioIds: string[],
    checks: { success?: boolean }[],
    threshold: number,
    expectedChecks: number,
): void {
    addApplicableRateGate(
        add,
        id,
        title,
        applicableScenarioIds.length > 0,
        checks.filter(check => check.success === true).length,
        checks.length,
        threshold,
        expectedChecks,
    );
}

function addBaselineGates(
    add: AddReleaseGate,
    report: EvaluationReport,
    summaries: EvaluationSummary[],
    baselineSummaries: EvaluationSummary[],
    scenarios: CorEvaluationScenario[],
    thresholds: ReleaseThresholds,
): void {
    const comparison = report.baselineComparison;
    const baselineRequired = thresholds.baseline.required;
    if (!comparison) {
        const status: ReleaseGateStatus = baselineRequired ? 'missing_evidence' : 'not_applicable';
        for (const [id, title, threshold] of [
            ['same-model-baseline', 'Same-model paired baseline', 'verified model parity and complete pairing'],
            ['baseline-non-inferiority', 'Paired baseline non-inferiority', `final Δ ≥ ${formatSignedPercent(thresholds.baseline.minimumFinalSuccessRateDelta)}; first-pass Δ ≥ ${formatSignedPercent(thresholds.baseline.minimumFirstPassSuccessRateDelta)}`],
            ['latency-multiplier', 'Paired latency multiplier', `every model ≤ ${thresholds.efficiency.maximumLatencyMultiplier}×`],
            ['cost-multiplier', 'Paired cost multiplier', `every model ≤ ${thresholds.efficiency.maximumCostMultiplier}× ${thresholds.efficiency.costMetric}`],
        ]) {
            add(id, title, null, threshold, status, baselineRequired
                ? 'Required controlled-baseline evidence is absent.'
                : 'The threshold set does not require a controlled baseline.');
        }
        return;
    }

    const candidateAttempts = summaries.flatMap(summary => summary.results);
    const matchedCoverage = candidateAttempts.length
        ? comparison.matchedAttempts / candidateAttempts.length
        : null;
    const pairCounts = pairedModelScenarioCounts(summaries, baselineSummaries);
    const candidateSummaryMap = summaryByAttempt(summaries);
    const models = unique(candidateAttempts.map(attempt =>
        reportModel(attempt, candidateSummaryMap.get(attempt))));
    const insufficientGroups = models.flatMap(model => scenarios.map(scenario => {
        const key = `${model}\0${scenario.id}`;
        return { key, count: pairCounts.get(key) ?? 0 };
    })).filter(value => value.count < thresholds.baseline.minimumPairsPerModelScenario);
    const pairingVerified = comparison.modelProvenance.parity === 'verified'
        && comparison.unmatchedCandidateAttempts === 0
        && comparison.unmatchedBaselineAttempts === 0
        && matchedCoverage !== null
        && matchedCoverage >= thresholds.baseline.minimumMatchedPairCoverage
        && insufficientGroups.length === 0;
    add(
        'same-model-baseline',
        'Same-model paired baseline',
        matchedCoverage,
        `verified parity; coverage ≥ ${formatPercent(thresholds.baseline.minimumMatchedPairCoverage)}; ≥ ${thresholds.baseline.minimumPairsPerModelScenario} pair(s) per model + scenario`,
        pairingVerified ? 'passed' : 'missing_evidence',
        `Parity=${comparison.modelProvenance.parity}; matched=${comparison.matchedAttempts}; unmatched Rails=${comparison.unmatchedCandidateAttempts}; unmatched baseline=${comparison.unmatchedBaselineAttempts}; under-repeated groups=${insufficientGroups.length}.`,
    );

    const nonInferior = comparison.byModel.every(value =>
        value.allAutonomous.successRateDelta !== null
        && value.allAutonomous.successRateDelta >= thresholds.baseline.minimumFinalSuccessRateDelta
        && value.allAutonomous.firstPassRateDelta !== null
        && value.allAutonomous.firstPassRateDelta >= thresholds.baseline.minimumFirstPassSuccessRateDelta);
    const nonInferiorityMissing = !comparison.byModel.length || comparison.byModel.some(value =>
        value.allAutonomous.successRateDelta === null || value.allAutonomous.firstPassRateDelta === null);
    add(
        'baseline-non-inferiority',
        'Paired baseline non-inferiority',
        comparison.byModel.length
            ? comparison.byModel.map(value =>
                `${value.model}: final ${formatSignedPercent(value.allAutonomous.successRateDelta)}, first ${formatSignedPercent(value.allAutonomous.firstPassRateDelta)}`).join('; ')
            : null,
        `final Δ ≥ ${formatSignedPercent(thresholds.baseline.minimumFinalSuccessRateDelta)}; first-pass Δ ≥ ${formatSignedPercent(thresholds.baseline.minimumFirstPassSuccessRateDelta)}`,
        nonInferiorityMissing ? 'missing_evidence' : nonInferior ? 'passed' : 'failed',
        'Deltas are computed only from exact same-model, same-scenario, same-attempt, same-endpoint pairs.',
    );

    addMultiplierGate(
        add,
        'latency-multiplier',
        'Paired latency multiplier',
        comparison.byModel.map(value => ({
            model: value.model,
            candidate: value.durationMs.candidateAverage,
            baseline: value.durationMs.baselineAverage,
        })),
        thresholds.efficiency.maximumLatencyMultiplier,
        'duration',
    );
    addMultiplierGate(
        add,
        'cost-multiplier',
        'Paired cost multiplier',
        comparison.byModel.map(value => ({
            model: value.model,
            candidate: value.usage[thresholds.efficiency.costMetric].candidateAverage,
            baseline: value.usage[thresholds.efficiency.costMetric].baselineAverage,
        })),
        thresholds.efficiency.maximumCostMultiplier,
        thresholds.efficiency.costMetric,
    );
}

function addMultiplierGate(
    add: AddReleaseGate,
    id: string,
    title: string,
    values: { model: string; candidate: number | null; baseline: number | null }[],
    maximum: number,
    metric: string,
): void {
    const multipliers = values.map(value => ({
        model: value.model,
        value: value.candidate !== null && value.baseline !== null && value.baseline > 0
            ? value.candidate / value.baseline
            : null,
    }));
    const missing = !multipliers.length || multipliers.some(value => value.value === null);
    const failed = multipliers.some(value => value.value !== null && value.value > maximum);
    add(
        id,
        title,
        multipliers.length
            ? multipliers.map(value => `${value.model}=${value.value === null ? 'missing' : `${value.value.toFixed(2)}×`}`).join('; ')
            : null,
        `every model ≤ ${maximum}×`,
        missing ? 'missing_evidence' : failed ? 'failed' : 'passed',
        missing
            ? `Paired ${metric} evidence requires non-zero baseline measurements for every model.`
            : `Every multiplier uses paired per-model ${metric} averages.`,
    );
}

function addProvenanceGate(
    add: AddReleaseGate,
    summaries: EvaluationSummary[],
    baselineSummaries: EvaluationSummary[],
    thresholds: ReleaseThresholds,
    criticalCodes: Set<string>,
): void {
    const allSummaries = [...summaries, ...baselineSummaries];
    const attempts = allSummaries.flatMap(summary => summary.results);
    const missing: string[] = [];
    for (const summary of allSummaries) {
        if (thresholds.provenance.requireDeclaredArms && !summary.evaluationArm) {
            missing.push('summary arm');
        }
        for (const attempt of summary.results) {
            if (thresholds.provenance.requireDeclaredArms && !attempt.evaluationArm) {
                missing.push(`${attempt.runId}: arm`);
            }
            if (
                thresholds.provenance.requireAttemptCommitAndAssetHash
                && (!attempt.candidateCommit || !attempt.agentAssetsHash)
            ) {
                missing.push(`${attempt.runId}: commit/assets`);
            }
            if (
                thresholds.provenance.requireRequestedAndObservedModel
                && (!attempt.requestedModel || !attempt.observedModels?.length)
            ) {
                missing.push(`${attempt.runId}: model`);
            }
            if (
                thresholds.provenance.requireEvaluationDefinitionHash
                && !isEvaluationDefinitionProvenance(attempt.evaluationDefinition)
            ) {
                missing.push(`${attempt.runId}: evaluation definition`);
            }
        }
    }
    const cleanupFailures = thresholds.provenance.requireCleanupEvidence
        ? attempts.filter(attempt => criticalCodes.has(attempt.failureCode ?? '')
            && /cleanup|finalization/i.test(attempt.failureCode ?? ''))
        : [];
    const completeAttempts = attempts.filter(attempt =>
        (!thresholds.provenance.requireDeclaredArms || !!attempt.evaluationArm)
        && (!thresholds.provenance.requireAttemptCommitAndAssetHash
            || (!!attempt.candidateCommit && !!attempt.agentAssetsHash))
        && (!thresholds.provenance.requireRequestedAndObservedModel
            || (!!attempt.requestedModel && !!attempt.observedModels?.length))
        && (!thresholds.provenance.requireEvaluationDefinitionHash
            || isEvaluationDefinitionProvenance(attempt.evaluationDefinition))).length;
    add(
        'cleanup-provenance',
        'Cleanup and evidence provenance',
        attempts.length ? `${completeAttempts}/${attempts.length} attempts complete` : null,
        'declared arms, commit/assets, requested+observed model, evaluation definition, and no cleanup/finalization failure',
        !attempts.length || missing.length ? 'missing_evidence' : cleanupFailures.length ? 'failed' : 'passed',
        !attempts.length
            ? 'No attempts are present.'
            : missing.length
                ? `Missing provenance (${missing.length}): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}.`
                : cleanupFailures.length
                    ? `Cleanup/finalization failures: ${cleanupFailures.map(value => value.runId).join(', ')}.`
                    : 'Every supplied attempt has explicit provenance; persisted results contain no cleanup/finalization failure.',
    );
}

function pairedModelScenarioCounts(
    summaries: EvaluationSummary[],
    baselineSummaries: EvaluationSummary[],
): Map<string, number> {
    const baselineMap = new Set(baselineSummaries.flatMap(summary =>
        summary.results.map(attempt => pairingKey(summary, attempt))));
    const summaryMap = summaryByAttempt(summaries);
    const counts = new Map<string, number>();
    for (const attempt of summaries.flatMap(summary => summary.results)) {
        const summary = summaryMap.get(attempt);
        if (summary && baselineMap.has(pairingKey(summary, attempt))) {
            const key = `${reportModel(attempt, summary)}\0${attempt.scenarioId}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    return counts;
}

function finalLocalValidations(attempts: EvaluationAttempt[]): {
    attempt: EvaluationAttempt;
    validation: NonNullable<NonNullable<EvaluationAttempt['stages']>[number]['localRuntimeValidation']>;
}[] {
    return attempts.flatMap(attempt => {
        const stages = attempt.stages?.filter(stage => stage.name === 'local-runtime') ?? [];
        const validation = stages[stages.length - 1]?.localRuntimeValidation;
        return validation ? [{ attempt, validation }] : [];
    });
}

function releaseAssessmentFromGates(
    gates: ReleaseGateResult[],
): EvaluationReport['releaseAssessment'] {
    const missing = gates.filter(gate => gate.status === 'missing_evidence');
    const failed = gates.filter(gate => gate.status === 'failed');
    return {
        recommendation: missing.length
            ? 'insufficient_evidence'
            : failed.length ? 'hold' : 'candidate',
        reasons: missing.length
            ? missing.map(gate => `${gate.title}: ${gate.rationale}`)
            : failed.length
                ? failed.map(gate => `${gate.title}: ${gate.rationale}`)
                : ['All applicable versioned release gates passed.'],
    };
}

function formatPercent(value: number | null): string {
    return value === null ? 'missing' : `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number | null): string {
    return value === null ? 'missing' : `${value > 0 ? '+' : ''}${formatPercent(value)}`;
}

function validateVsCodeParitySources(
    results: SandboxVsCodeParityResult[],
    summaries: EvaluationSummary[],
    scenarios: Map<string, CorEvaluationScenario>,
): void {
    const summaryByAttempt = new Map(summaries.flatMap(summary =>
        summary.results.map(attempt => [attempt.runId, { attempt, summary }] as const)));
    for (const result of results) {
        const provenance = result.sourceProvenance;
        if (!provenance) {
            throw new Error('VS Code parity evidence is missing source-attempt provenance.');
        }
        const source = summaryByAttempt.get(provenance.runId);
        if (
            !source
            || source.summary.evaluationArm !== 'rails'
            || source.summary.through !== 'local'
            || source.attempt.evaluationArm !== 'rails'
            || source.attempt.scenarioId !== provenance.scenarioId
            || source.attempt.attempt !== provenance.attempt
            || source.attempt.candidateCommit !== provenance.candidateCommit
            || source.attempt.agentAssetsHash !== provenance.agentAssetsHash
            || !sameOptionalEvaluationDefinition(
                source.attempt.evaluationDefinition,
                provenance.evaluationDefinition,
            )
            || source.attempt.requestedModel !== provenance.requestedModel
            || !sameValues(normalizedModels(source.attempt.observedModels ?? []), provenance.observedModels)
            || JSON.stringify(scenarios.get(provenance.scenarioId)?.acceptance?.local?.debugParity)
                !== JSON.stringify(provenance.debugParity)
        ) {
            throw new Error(`VS Code parity evidence for run "${provenance.runId}" does not match a report input attempt.`);
        }
    }
}

function validateDeploymentSources(
    results: LiveDeploymentResult[],
    summaries: EvaluationSummary[],
): void {
    const summaryByAttempt = new Map(summaries.flatMap(summary =>
        summary.results.map(attempt => [attempt.runId, { attempt, summary }] as const)));
    for (const result of results) {
        const provenance = result.sourceProvenance;
        const source = provenance && summaryByAttempt.get(provenance.runId);
        if (
            !provenance
            || !source
            || provenance.evaluationArm !== 'rails'
            || provenance.through !== 'local'
            || source.summary.evaluationArm !== provenance.evaluationArm
            || source.summary.through !== provenance.through
            || source.attempt.scenarioId !== provenance.scenarioId
            || source.attempt.attempt !== provenance.attempt
            || source.attempt.candidateCommit !== provenance.candidateCommit
            || source.attempt.agentAssetsHash !== provenance.agentAssetsHash
            || !sameOptionalEvaluationDefinition(
                source.attempt.evaluationDefinition,
                provenance.evaluationDefinition,
            )
            || source.attempt.requestedModel !== provenance.requestedModel
            || !sameValues(normalizedModels(source.attempt.observedModels ?? []), provenance.observedModels)
        ) {
            throw new Error(`Live deployment evidence for run "${provenance?.runId ?? 'unknown'}" does not match a report input attempt.`);
        }
    }
}

function compareBaseline(
    candidateSummaries: EvaluationSummary[],
    baselineSummaries: EvaluationSummary[],
    scenarios: Map<string, CorEvaluationScenario>,
    armProvenance: NonNullable<EvaluationReport['baselineComparison']>['armProvenance'],
): NonNullable<EvaluationReport['baselineComparison']> {
    const candidate = candidateSummaries.flatMap(summary => summary.results);
    const baseline = baselineSummaries.flatMap(summary => summary.results);
    const candidateSummaryByAttempt = summaryByAttempt(candidateSummaries);
    const baselineSummaryByAttempt = summaryByAttempt(baselineSummaries);
    const endpointProvenance = validateEndpointParity(candidateSummaries, baselineSummaries);
    validateCandidateCommitParity(candidateSummaries, baselineSummaries);
    validatePairingModelSets(candidateSummaries, baselineSummaries);
    validateDeclaredSummaryModels(candidateSummaries, 'Candidate', 'rails');
    validateDeclaredSummaryModels(baselineSummaries, 'Baseline', 'baseline-controlled');
    assertUniquePairingKeys(candidateSummaries, 'candidate');
    assertUniquePairingKeys(baselineSummaries, 'baseline');
    const baselineMap = new Map(baseline.map(attempt => [
        pairingKey(baselineSummaryByAttempt.get(attempt), attempt),
        attempt,
    ]));
    const pairs = candidate.flatMap(attempt => {
        const previous = baselineMap.get(pairingKey(candidateSummaryByAttempt.get(attempt), attempt));
        return previous ? [{ candidate: attempt, baseline: previous }] : [];
    });
    const modelProvenance = validatePairedModels(
        pairs,
        candidateSummaryByAttempt,
        baselineSummaryByAttempt,
    );
    const evaluationDefinitionProvenance = validatePairedEvaluationDefinitions(
        pairs,
        candidateSummaries,
        baselineSummaries,
    );
    const allAutonomous = compareOutcomePairs(pairs);
    const productQuality = compareProductQualityPairs(pairs);
    const matchedKeys = new Set(pairs.map(pair =>
        pairingKey(candidateSummaryByAttempt.get(pair.candidate), pair.candidate)));
    const byScenario = unique(pairs.map(pair => pair.candidate.scenarioId))
        .map(scenarioId => ({
            scenarioId,
            ...compareGroupedPairs(pairs.filter(pair => pair.candidate.scenarioId === scenarioId)),
        }));
    const byModel = unique(pairs.map(pair =>
        reportModel(pair.candidate, candidateSummaryByAttempt.get(pair.candidate))))
        .map(model => {
            const modelPairs = pairs.filter(pair =>
                reportModel(pair.candidate, candidateSummaryByAttempt.get(pair.candidate)) === model);
            return {
                model,
                ...compareGroupedPairs(modelPairs),
                durationMs: comparePairValues(
                    modelPairs,
                    pair => pair.candidate.durationMs,
                    pair => pair.baseline.durationMs,
                ),
                usage: {
                    inputTokens: compareUsage(modelPairs, 'inputTokens'),
                    outputTokens: compareUsage(modelPairs, 'outputTokens'),
                    reasoningTokens: compareUsage(modelPairs, 'reasoningTokens'),
                    cacheReadTokens: compareUsage(modelPairs, 'cacheReadTokens'),
                    totalNanoAiu: compareUsage(modelPairs, 'totalNanoAiu'),
                },
            };
        });
    const tagKeys = unique(pairs.flatMap(pair =>
        Object.entries(scenarios.get(pair.candidate.scenarioId)?.tags ?? {})
            .map(([tag, value]) => `${tag}\0${value}`)));
    const byTag = tagKeys.map(key => {
        const [tag, value] = key.split('\0');
        const taggedPairs = pairs.filter(pair =>
            scenarios.get(pair.candidate.scenarioId)?.tags?.[tag] === value);
        return { tag, value, ...compareGroupedPairs(taggedPairs) };
    });
    return {
        matchedAttempts: pairs.length,
        unmatchedCandidateAttempts: candidate.length - pairs.length,
        unmatchedBaselineAttempts: baseline.filter(attempt =>
            !matchedKeys.has(pairingKey(baselineSummaryByAttempt.get(attempt), attempt))).length,
        improvements: allAutonomous.railsOnlyWins,
        regressions: allAutonomous.baselineOnlyWins,
        unchangedPasses: allAutonomous.bothPass,
        unchangedFailures: allAutonomous.bothFail,
        candidateRate: allAutonomous.candidateSuccess.rate,
        baselineRate: allAutonomous.baselineSuccess.rate,
        delta: allAutonomous.successRateDelta,
        armProvenance,
        endpointProvenance,
        modelProvenance,
        evaluationDefinitionProvenance,
        allAutonomous,
        productQuality,
        durationMs: comparePairValues(pairs, pair => pair.candidate.durationMs, pair => pair.baseline.durationMs),
        usage: {
            inputTokens: compareUsage(pairs, 'inputTokens'),
            outputTokens: compareUsage(pairs, 'outputTokens'),
            reasoningTokens: compareUsage(pairs, 'reasoningTokens'),
            cacheReadTokens: compareUsage(pairs, 'cacheReadTokens'),
            totalNanoAiu: compareUsage(pairs, 'totalNanoAiu'),
        },
        byScenario,
        byModel,
        byTag,
    };
}

function validateCandidateCommitParity(
    candidate: EvaluationSummary[],
    baseline: EvaluationSummary[],
): void {
    const candidateCommits = unique(candidate.map(summary => summary.candidateCommit));
    const baselineCommits = unique(baseline.map(summary => summary.candidateCommit));
    if (!sameValues(candidateCommits, baselineCommits)) {
        throw new Error(
            'Paired report candidate commit mismatch: '
            + `Rails ${JSON.stringify(candidateCommits)}, baseline ${JSON.stringify(baselineCommits)}.`,
        );
    }
}

interface AttemptPair {
    candidate: EvaluationAttempt;
    baseline: EvaluationAttempt;
}

interface AttemptModelEvidence {
    requestedModel?: string;
    observedModels: string[];
    hasObservedEvidence: boolean;
    hasDirectRequestedEvidence: boolean;
    hasDirectObservedEvidence: boolean;
}

function validateDeclaredSummaryModels(
    summaries: EvaluationSummary[],
    label: string,
    expectedArm: NonNullable<EvaluationAttempt['evaluationArm']>,
): void {
    for (const summary of summaries) {
        validateSummaryModelEvidence(summary, label);
        if (summary.evaluationArm === undefined) {
            continue;
        }
        for (const attempt of summary.results) {
            const key = attemptKey(attempt);
            const evidence = deriveAttemptModelEvidence(attempt, summary, expectedArm);
            validateDeclaredModelEvidence(key, label, summary, evidence);
            validateObservedPin(key, expectedArm === 'rails' ? 'Rails' : 'baseline', evidence);
            validateAttemptSummaryModelConsistency(key, label, attempt, summary);
        }
    }
}

function validatePairingModelSets(
    candidate: EvaluationSummary[],
    baseline: EvaluationSummary[],
): void {
    const candidateModels = pairingModelsByCoreKey(candidate);
    const baselineModels = pairingModelsByCoreKey(baseline);
    for (const [key, candidateValues] of candidateModels) {
        const baselineValues = baselineModels.get(key);
        if (baselineValues && !sameValues(candidateValues, baselineValues)) {
            throw new Error(
                `Paired attempt ${key.replace(/\0/g, '/')} requested different models: `
                + `Rails ${JSON.stringify(candidateValues)}, baseline ${JSON.stringify(baselineValues)}.`,
            );
        }
    }
}

function pairingModelsByCoreKey(summaries: EvaluationSummary[]): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const summary of summaries) {
        for (const attempt of summary.results) {
            const key = `${summary.through}\0${attemptKey(attempt)}`;
            grouped.set(key, unique([
                ...(grouped.get(key) ?? []),
                reportModel(attempt, summary),
            ]));
        }
    }
    return grouped;
}

function validateEndpointParity(
    candidate: EvaluationSummary[],
    baseline: EvaluationSummary[],
): NonNullable<EvaluationReport['baselineComparison']>['endpointProvenance'] {
    const endpointProvenance = {
        candidate: unique(candidate.map(summary => summary.through)),
        baseline: unique(baseline.map(summary => summary.through)),
    };
    if (!sameValues(endpointProvenance.candidate, endpointProvenance.baseline)) {
        throw new Error(
            'Paired report evaluation endpoint mismatch: '
            + `candidate through endpoints ${JSON.stringify(endpointProvenance.candidate)}, `
            + `baseline through endpoints ${JSON.stringify(endpointProvenance.baseline)}. `
            + 'Candidate and baseline endpoint sets must match exactly.',
        );
    }
    return endpointProvenance;
}

function validatePairedModels(
    pairs: AttemptPair[],
    candidateSummaryByAttempt: Map<EvaluationAttempt, EvaluationSummary>,
    baselineSummaryByAttempt: Map<EvaluationAttempt, EvaluationSummary>,
): NonNullable<EvaluationReport['baselineComparison']>['modelProvenance'] {
    const candidateEvidence: { key: string; evidence: AttemptModelEvidence }[] = [];
    const baselineEvidence: { key: string; evidence: AttemptModelEvidence }[] = [];
    for (const pair of pairs) {
        const key = attemptKey(pair.candidate);
        const candidateSummary = candidateSummaryByAttempt.get(pair.candidate);
        const baselineSummary = baselineSummaryByAttempt.get(pair.baseline);
        if (!candidateSummary || !baselineSummary) {
            throw new Error(`Internal report error resolving summary provenance for paired attempt ${key}.`);
        }
        if (candidateSummary.candidateCommit !== baselineSummary.candidateCommit) {
            throw new Error(
                `Paired attempt ${key} candidate commit mismatch: `
                + `Rails "${candidateSummary.candidateCommit}", baseline "${baselineSummary.candidateCommit}".`,
            );
        }
        validateSummaryModelEvidence(candidateSummary, 'Candidate');
        validateSummaryModelEvidence(baselineSummary, 'Baseline');
        const candidate = deriveAttemptModelEvidence(pair.candidate, candidateSummary, 'rails');
        const baseline = deriveAttemptModelEvidence(pair.baseline, baselineSummary, 'baseline-controlled');
        candidateEvidence.push({ key, evidence: candidate });
        baselineEvidence.push({ key, evidence: baseline });
        const candidateModel = candidate.requestedModel;
        const baselineModel = baseline.requestedModel;
        if (candidateModel && baselineModel && candidateModel !== baselineModel) {
            throw new Error(
                `Paired attempt ${key} requested different models: `
                + `Rails "${candidateModel}", baseline "${baselineModel}".`,
            );
        }

        validateDeclaredModelEvidence(key, 'Candidate', candidateSummary, candidate);
        validateDeclaredModelEvidence(key, 'Baseline', baselineSummary, baseline);
        validateObservedPin(key, 'Rails', candidate);
        validateObservedPin(key, 'baseline', baseline);
        validateAttemptSummaryModelConsistency(key, 'Candidate', pair.candidate, candidateSummary);
        validateAttemptSummaryModelConsistency(key, 'Baseline', pair.baseline, baselineSummary);
        if (
            candidate.hasObservedEvidence
            && baseline.hasObservedEvidence
            && !sameValues(candidate.observedModels, baseline.observedModels)
        ) {
            throw new Error(
                `Paired attempt ${key} observed different model sets: `
                + `Rails ${JSON.stringify(candidate.observedModels)}, `
                + `baseline ${JSON.stringify(baseline.observedModels)}.`,
            );
        }
    }
    const candidate = summarizeModelProvenance(candidateEvidence);
    const baseline = summarizeModelProvenance(baselineEvidence);
    return {
        candidate,
        baseline,
        parity: pairs.length === 0
            ? 'not_evaluated'
            : candidate.status === 'verified' && baseline.status === 'verified'
                ? 'verified'
                : 'legacy_missing',
    };
}

function validatePairedEvaluationDefinitions(
    pairs: AttemptPair[],
    candidateSummaries: EvaluationSummary[],
    baselineSummaries: EvaluationSummary[],
): NonNullable<EvaluationReport['baselineComparison']>['evaluationDefinitionProvenance'] {
    const candidate = summarizeEvaluationDefinitions(candidateSummaries);
    const baseline = summarizeEvaluationDefinitions(baselineSummaries);
    for (const pair of pairs) {
        const candidateDefinition = pair.candidate.evaluationDefinition;
        const baselineDefinition = pair.baseline.evaluationDefinition;
        if (
            (candidateDefinition !== undefined || baselineDefinition !== undefined)
            && (
                candidateDefinition === undefined
                || baselineDefinition === undefined
                || !sameEvaluationDefinition(candidateDefinition, baselineDefinition)
            )
        ) {
            throw new Error(
                `Paired attempt ${attemptKey(pair.candidate)} evaluation definition mismatch: `
                + `Rails "${candidateDefinition?.combinedHash ?? 'legacy_missing'}", `
                + `baseline "${baselineDefinition?.combinedHash ?? 'legacy_missing'}".`,
            );
        }
    }
    return {
        candidate,
        baseline,
        parity: pairs.length === 0
            ? 'not_evaluated'
            : candidate.status === 'verified' && baseline.status === 'verified'
                ? 'verified'
                : 'legacy_missing',
    };
}

function summarizeEvaluationDefinitions(
    summaries: EvaluationSummary[],
): EvaluationDefinitionSummary {
    const definitions: EvaluationDefinitionProvenance[] = [];
    const missingAttempts: string[] = [];
    let attemptCount = 0;
    for (const summary of summaries) {
        const summaryDefinitions = validateSummaryEvaluationDefinitions(summary);
        for (const attempt of summary.results) {
            attemptCount++;
            const definition = attempt.evaluationDefinition;
            if (definition !== undefined && !isEvaluationDefinitionProvenance(definition)) {
                throw new Error(`Attempt ${attemptKey(attempt)} has malformed evaluation-definition provenance.`);
            }
            if (!definition) {
                missingAttempts.push(attemptKey(attempt));
                continue;
            }
            if (!summaryDefinitions.some(value => sameEvaluationDefinition(value, definition))) {
                throw new Error(
                    `Attempt ${attemptKey(attempt)} evaluation definition is absent from its summary provenance.`,
                );
            }
            definitions.push(definition);
        }
    }
    return {
        hashes: unique(definitions.map(value => value.combinedHash)),
        scenarioCorpusHashes: unique(definitions.map(value => value.scenarioCorpusHash)),
        evaluatorHashes: unique(definitions.map(value => value.evaluatorHash)),
        productContractHashes: unique(definitions.map(value => value.productContractHash)),
        missingAttempts,
        status: attemptCount === 0
            ? 'not_evaluated'
            : missingAttempts.length ? 'legacy_missing' : 'verified',
    };
}

function validateSummaryEvaluationDefinitions(
    summary: EvaluationSummary,
): EvaluationDefinitionProvenance[] {
    if (summary.evaluationDefinitions === undefined) {
        return [];
    }
    if (
        !Array.isArray(summary.evaluationDefinitions)
        || !summary.evaluationDefinitions.length
        || summary.evaluationDefinitions.some(value => !isEvaluationDefinitionProvenance(value))
    ) {
        throw new Error('Summary has malformed evaluation-definition provenance.');
    }
    const hashes = summary.evaluationDefinitions.map(value => value.combinedHash);
    if (new Set(hashes).size !== hashes.length) {
        throw new Error('Summary has duplicate evaluation-definition provenance.');
    }
    return summary.evaluationDefinitions;
}

function validateAttemptSummaryModelConsistency(
    key: string,
    label: string,
    attempt: EvaluationAttempt,
    summary: EvaluationSummary,
): void {
    const summaryRequested = summaryRequestedModels(summary);
    const attemptRequested = normalizedModels([
        ...(attempt.requestedModel ? [attempt.requestedModel] : []),
        ...(attempt.model ? [attempt.model] : []),
    ]);
    if (attemptRequested.length > 1) {
        throw new Error(`${label} paired attempt ${key} declares conflicting requested models.`);
    }
    if (
        attemptRequested.length
        && summaryRequested.length
        && !summaryRequested.includes(attemptRequested[0])
    ) {
        throw new Error(
            `${label} paired attempt ${key} requested model "${attemptRequested[0]}" conflicts with `
            + `summary requested models ${JSON.stringify(summaryRequested)}.`,
        );
    }
    const attemptObserved = attempt.observedModels === undefined
        ? []
        : normalizedModels(attempt.observedModels);
    const summaryObserved = normalizedModels(summary.observedModels ?? []);
    if (
        attemptObserved.length
        && summaryObserved.length
        && attemptObserved.some(model => !summaryObserved.includes(model))
    ) {
        throw new Error(
            `${label} paired attempt ${key} observed models ${JSON.stringify(attemptObserved)} conflict with `
            + `summary observed models ${JSON.stringify(summaryObserved)}.`,
        );
    }
}

function validateSummaryModelEvidence(summary: EvaluationSummary, label: string): void {
    const requested = summaryRequestedModels(summary);
    const observed = normalizedModels(summary.observedModels ?? []);
    if (requested.length && observed.length && !sameValues(requested, observed)) {
        throw new Error(
            `${label} summary for through endpoint "${summary.through}" declares requested models `
            + `${JSON.stringify(requested)} but observed ${JSON.stringify(observed)}.`,
        );
    }
}

function deriveAttemptModelEvidence(
    attempt: EvaluationAttempt,
    summary: EvaluationSummary,
    expectedArm: NonNullable<EvaluationAttempt['evaluationArm']>,
): AttemptModelEvidence {
    const directRequestedModels = normalizedModels([
        ...(attempt.requestedModel ? [attempt.requestedModel] : []),
        ...(attempt.model ? [attempt.model] : []),
    ]);
    const requestedModel = singleValue(directRequestedModels)
        ?? singleValue(summaryRequestedModels(summary));
    if (attempt.observedModels !== undefined) {
        const observedModels = normalizedModels(attempt.observedModels);
        return {
            requestedModel,
            observedModels,
            hasObservedEvidence: observedModels.length > 0,
            hasDirectRequestedEvidence: directRequestedModels.length === 1,
            hasDirectObservedEvidence: observedModels.length > 0,
        };
    }
    if (summary.evaluationArm === undefined && expectedArm === 'rails') {
        const observedModels = normalizedModels(
            attempt.stages?.flatMap(stage => stage.agentRun?.usage?.models ?? []) ?? [],
        );
        if (observedModels.length) {
            return {
                requestedModel,
                observedModels,
                hasObservedEvidence: true,
                hasDirectRequestedEvidence: directRequestedModels.length === 1,
                hasDirectObservedEvidence: false,
            };
        }
    }
    const observedModels = normalizedModels(summary.observedModels ?? []);
    return {
        requestedModel,
        observedModels,
        hasObservedEvidence: observedModels.length > 0,
        hasDirectRequestedEvidence: directRequestedModels.length === 1,
        hasDirectObservedEvidence: false,
    };
}

function validateDeclaredModelEvidence(
    key: string,
    label: string,
    summary: EvaluationSummary,
    evidence: AttemptModelEvidence,
): void {
    if (summary.evaluationArm === undefined) {
        return;
    }
    if (!evidence.requestedModel || !evidence.hasDirectRequestedEvidence) {
        throw new Error(
            `${label} paired attempt ${key} is missing requested-model evidence under declared arm `
            + `"${summary.evaluationArm}".`,
        );
    }
    if (!evidence.hasObservedEvidence || !evidence.hasDirectObservedEvidence) {
        throw new Error(
            `${label} paired attempt ${key} is missing observed-model evidence under declared arm `
            + `"${summary.evaluationArm}".`,
        );
    }
}

function validateObservedPin(key: string, label: string, evidence: AttemptModelEvidence): void {
    if (
        evidence.requestedModel
        && evidence.hasObservedEvidence
        && !sameValues(evidence.observedModels, [evidence.requestedModel])
    ) {
        throw new Error(
            `Paired attempt ${key} ${label} observed models ${JSON.stringify(evidence.observedModels)}; `
            + `expected exactly requested model "${evidence.requestedModel}".`,
        );
    }
}

function summarizeModelProvenance(
    values: { key: string; evidence: AttemptModelEvidence }[],
): ArmModelProvenance {
    const missingRequestedAttempts = values
        .filter(value => !value.evidence.requestedModel)
        .map(value => value.key);
    const missingObservedAttempts = values
        .filter(value => !value.evidence.hasObservedEvidence)
        .map(value => value.key);
    return {
        requestedModels: unique(values.flatMap(value =>
            value.evidence.requestedModel ? [value.evidence.requestedModel] : [])),
        observedModels: unique(values.flatMap(value => value.evidence.observedModels)),
        missingRequestedAttempts,
        missingObservedAttempts,
        status: values.length === 0
            ? 'not_evaluated'
            : missingRequestedAttempts.length || missingObservedAttempts.length
                ? 'legacy_missing'
                : 'verified',
    };
}

function summaryRequestedModels(summary: EvaluationSummary): string[] {
    return normalizedModels([
        ...(summary.requestedModel ? [summary.requestedModel] : []),
        ...(summary.requestedModels ?? []),
    ]);
}

function normalizedModels(models: string[]): string[] {
    return unique(models.filter(model => model.trim().length > 0));
}

function reportModel(
    attempt: EvaluationAttempt,
    summary: EvaluationSummary | undefined,
): string {
    const attemptModels = normalizedModels([
        ...(attempt.requestedModel ? [attempt.requestedModel] : []),
        ...(attempt.model ? [attempt.model] : []),
    ]);
    if (attemptModels.length > 1) {
        throw new Error(`Attempt ${attemptKey(attempt)} declares conflicting requested models.`);
    }
    return attemptModels[0]
        ?? singleValue(summary ? summaryRequestedModels(summary) : [])
        ?? 'legacy (model not recorded)';
}

function singleValue(values: string[]): string | undefined {
    return values.length === 1 ? values[0] : undefined;
}

function sameValues(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameOptionalEvaluationDefinition(
    left: EvaluationDefinitionProvenance | undefined,
    right: EvaluationDefinitionProvenance | undefined,
): boolean {
    return left === undefined && right === undefined
        || left !== undefined && right !== undefined && sameEvaluationDefinition(left, right);
}

function summaryByAttempt(summaries: EvaluationSummary[]): Map<EvaluationAttempt, EvaluationSummary> {
    return new Map(summaries.flatMap(summary =>
        summary.results.map(attempt => [attempt, summary] as const)));
}

function compareGroupedPairs(pairs: AttemptPair[]): GroupedPairedComparison {
    const productPairs = productEligiblePairs(pairs);
    return {
        allAutonomous: compareOutcomePairs(pairs),
        productQuality: productPairs.length ? compareProductQualityPairs(pairs) : undefined,
    };
}

function compareProductQualityPairs(pairs: AttemptPair[]): ProductQualityPairedComparison {
    const candidateExcludedAttempts = pairs.filter(pair => !isProductQualityAttempt(pair.candidate)).length;
    const baselineExcludedAttempts = pairs.filter(pair => !isProductQualityAttempt(pair.baseline)).length;
    const eligible = productEligiblePairs(pairs);
    return {
        ...compareOutcomePairs(eligible),
        candidateExcludedAttempts,
        baselineExcludedAttempts,
        excludedPairs: pairs.length - eligible.length,
    };
}

function productEligiblePairs(pairs: AttemptPair[]): AttemptPair[] {
    return pairs.filter(pair =>
        isProductQualityAttempt(pair.candidate) && isProductQualityAttempt(pair.baseline));
}

function isProductQualityAttempt(attempt: EvaluationAttempt): boolean {
    const category = classifyFailure(attempt);
    return category !== 'harness_failure' && category !== 'infrastructure_failure';
}

function compareOutcomePairs(pairs: AttemptPair[]): PairedOutcomeComparison {
    const candidateAttempts = pairs.map(pair => pair.candidate);
    const baselineAttempts = pairs.map(pair => pair.baseline);
    const railsOnlyWins = pairs.filter(pair =>
        passed(pair.candidate) && !passed(pair.baseline)).length;
    const baselineOnlyWins = pairs.filter(pair =>
        !passed(pair.candidate) && passed(pair.baseline)).length;
    const bothPass = pairs.filter(pair => passed(pair.candidate) && passed(pair.baseline)).length;
    const bothFail = pairs.filter(pair => !passed(pair.candidate) && !passed(pair.baseline)).length;
    const candidateSuccess = summarizeRate(candidateAttempts);
    const baselineSuccess = summarizeRate(baselineAttempts);
    const candidateFirstPass = summarizeFirstPassRate(candidateAttempts);
    const baselineFirstPass = summarizeFirstPassRate(baselineAttempts);
    const candidateRecoveredSuccesses = candidateAttempts.filter(recovered).length;
    const baselineRecoveredSuccesses = baselineAttempts.filter(recovered).length;
    return {
        matchedAttempts: pairs.length,
        railsOnlyWins,
        baselineOnlyWins,
        bothPass,
        bothFail,
        candidateSuccess,
        baselineSuccess,
        successRateDelta: rateDelta(candidateSuccess.rate, baselineSuccess.rate),
        candidateFirstPass,
        baselineFirstPass,
        firstPassRateDelta: rateDelta(candidateFirstPass.rate, baselineFirstPass.rate),
        candidateRecoveredSuccesses,
        baselineRecoveredSuccesses,
        recoveredSuccessDelta: candidateRecoveredSuccesses - baselineRecoveredSuccesses,
    };
}

function passed(attempt: EvaluationAttempt): boolean {
    return attempt.outcome === 'autonomous_success';
}

function recovered(attempt: EvaluationAttempt): boolean {
    return passed(attempt) && (attempt.agentRetries ?? 0) > 0;
}

function rateDelta(candidate: number | null, baseline: number | null): number | null {
    return candidate === null || baseline === null ? null : candidate - baseline;
}

function compareUsage(
    pairs: AttemptPair[],
    metric: keyof EvaluationReport['usage'],
): PairedValueComparison {
    return comparePairValues(
        pairs,
        pair => sumUsage([pair.candidate])[metric],
        pair => sumUsage([pair.baseline])[metric],
    );
}

function comparePairValues(
    pairs: AttemptPair[],
    candidateValue: (pair: AttemptPair) => number,
    baselineValue: (pair: AttemptPair) => number,
): PairedValueComparison {
    const candidateTotal = pairs.reduce((total, pair) => total + candidateValue(pair), 0);
    const baselineTotal = pairs.reduce((total, pair) => total + baselineValue(pair), 0);
    const candidateAverage = pairs.length ? candidateTotal / pairs.length : null;
    const baselineAverage = pairs.length ? baselineTotal / pairs.length : null;
    return {
        candidateTotal,
        baselineTotal,
        totalDelta: candidateTotal - baselineTotal,
        candidateAverage,
        baselineAverage,
        averageDelta: candidateAverage === null || baselineAverage === null
            ? null
            : candidateAverage - baselineAverage,
    };
}

function sumUsage(attempts: EvaluationAttempt[]): EvaluationReport['usage'] {
    const usage = {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        totalNanoAiu: 0,
    };
    for (const attempt of attempts) {
        for (const stage of attempt.stages ?? []) {
            const stageUsage = stage.agentRun?.usage;
            usage.inputTokens += stageUsage?.inputTokens ?? 0;
            usage.outputTokens += stageUsage?.outputTokens ?? 0;
            usage.reasoningTokens += stageUsage?.reasoningTokens ?? 0;
            usage.cacheReadTokens += stageUsage?.cacheReadTokens ?? 0;
            usage.totalNanoAiu += stageUsage?.totalNanoAiu ?? 0;
        }
    }
    return usage;
}

export function renderMarkdown(report: EvaluationReport): string {
    const lines = [
        '# Copilot on Rails Evaluation Report',
        '',
        `Generated: ${report.generatedAt}`,
        '',
        '## Outcome',
        '',
        '| Metric | Attempts | Successes | Rate | Wilson 95% |',
        '|---|---:|---:|---:|---:|',
        rateRow('First-pass outcome', report.firstPassOutcome),
        rateRow('Autonomous outcome', report.autonomousOutcome),
        rateRow('Product quality', report.productQuality),
        '',
        `Recovered by agent repair: ${report.recoveredSuccesses}.`,
        '',
        `Excluded from product-quality denominator: ${report.excludedFromProductQuality.harnessFailures} harness and ${report.excludedFromProductQuality.infrastructureFailures} infrastructure failures.`,
        '',
        '## Release Assessment',
        '',
        `Recommendation: **${report.releaseAssessment.recommendation}**`,
        '',
        ...report.releaseAssessment.reasons.map(reason => `- ${reason}`),
        '',
        `Evidence coverage: ${report.evidenceCoverage.evaluatedScenarios}/${report.evidenceCoverage.corpusScenarios} scenarios; ${report.evidenceCoverage.scenariosWithThreeAttempts}/${report.evidenceCoverage.corpusScenarios} with at least three repetitions.`,
        '',
        `Evaluation definition provenance: **${report.evaluationDefinitionProvenance.status}**; combined hash(es): ${renderCodeValues(report.evaluationDefinitionProvenance.hashes)}; evaluator hash(es): ${renderCodeValues(report.evaluationDefinitionProvenance.evaluatorHashes)}; product-contract hash(es): ${renderCodeValues(report.evaluationDefinitionProvenance.productContractHashes)}.`,
        '',
        ...(report.releaseGates ? [
            `Threshold set: \`${report.releaseGates.thresholdSet}\` (schema ${report.releaseGates.thresholdSchemaVersion}).`,
            '',
            '### Release Gates',
            '',
            '| Gate | Measured value | Threshold | Status | Rationale |',
            '|---|---|---|---|---|',
            ...report.releaseGates.results.map(gate =>
                `| ${escapeTable(gate.title)} | ${escapeTable(renderMeasuredValue(gate.measuredValue))} | ${escapeTable(gate.threshold)} | **${gate.status}** | ${escapeTable(gate.rationale)} |`),
            '',
        ] : []),
        '## Stage Journey',
        '',
        '| Stage | Attempts | First-pass | Recovered | Final successes | Final rate | Wilson 95% |',
        '|---|---:|---:|---:|---:|---:|---:|',
        ...report.stageJourney.map(value =>
            `| ${value.stage} | ${value.attempts} | ${value.firstPassSuccesses} | ${value.recoveredSuccesses} | ${value.successes} | ${percent(value.rate)} | ${interval(value.wilson95)} |`),
        '',
        '## User Journey Dimensions',
        '',
        '| Dimension | Attempts | Successes | Rate | Wilson 95% |',
        '|---|---:|---:|---:|---:|',
        ...report.userJourneyDimensions.map(value => rateRow(value.dimension, value)),
        '',
        '## Browser and Accessibility',
        '',
        '| Browser checks | Successes | Rate | Wilson 95% | Serious/critical accessibility violations | Console errors |',
        '|---:|---:|---:|---:|---:|---:|',
        `| ${report.browserAcceptance.attempts} | ${report.browserAcceptance.successes} | ${percent(report.browserAcceptance.rate)} | ${interval(report.browserAcceptance.wilson95)} | ${report.browserAcceptance.seriousAccessibilityViolations} | ${report.browserAcceptance.consoleErrors} |`,
        '',
        'Interaction journey: ' + rateSummaryText(report.browserAcceptance.interaction) + '.',
        '',
        `Accessibility scans completed: ${report.browserAcceptance.accessibilityScans}/${report.browserAcceptance.attempts}; scan failures: ${report.browserAcceptance.accessibilityScanFailures}.`,
        '',
        '## VS Code F5 and Breakpoint Parity',
        '',
        rateSummaryText(report.vscodeParity) + '.',
        '',
        '| Outcome | VS Code | Configuration | Source location | Stop reason | Failure code |',
        '|---|---|---|---|---|---|',
        ...report.vscodeParity.runs.map(value =>
            `| ${value.outcome} | ${value.codeVersion ?? 'N/A'} | ${value.configurationName ?? 'N/A'} | ${value.source ? `${value.source}:${value.line ?? '?'}:${value.column ?? '?'}` : 'N/A'} | ${value.stoppedReason ?? 'N/A'} | ${value.failureCode ?? 'N/A'} |`),
        '',
        '## Live Deployment',
        '',
        `${rateSummaryText(report.liveDeployment)}. Cleanup verified: ${report.liveDeployment.cleanupVerified}/${report.liveDeployment.attempts}.`,
        '',
        '## By Scenario',
        '',
        '| Scenario | Attempts | Successes | Rate | Wilson 95% |',
        '|---|---:|---:|---:|---:|',
        ...report.byScenario.map(value => rateRow(value.scenarioId, value)),
        '',
        '## By Model',
        '',
        '| Model | Attempts | Autonomous | First-pass | Recovered | Product quality | Average duration (ms) | Input tokens | Output tokens |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
        ...report.byModel.map(value =>
            `| ${value.model} | ${value.autonomousOutcome.attempts} | ${percent(value.autonomousOutcome.rate)} | ${percent(value.firstPassOutcome.rate)} | ${value.recoveredSuccesses} | ${percent(value.productQuality.rate)} | ${decimal(value.duration.averageMs)} | ${value.usage.inputTokens} | ${value.usage.outputTokens} |`),
        '',
        '## By Model and Scenario',
        '',
        '| Model | Scenario | Attempts | Autonomous | First-pass | Recovered | Product quality | Average duration (ms) |',
        '|---|---|---:|---:|---:|---:|---:|---:|',
        ...report.byModelScenario.map(value =>
            `| ${value.model} | ${value.scenarioId} | ${value.autonomousOutcome.attempts} | ${percent(value.autonomousOutcome.rate)} | ${percent(value.firstPassOutcome.rate)} | ${value.recoveredSuccesses} | ${percent(value.productQuality.rate)} | ${decimal(value.duration.averageMs)} |`),
        '',
        '## By Tag',
        '',
        '| Tag | Value | Attempts | Successes | Rate | Wilson 95% |',
        '|---|---|---:|---:|---:|---:|',
        ...report.byTag.map(value =>
            `| ${value.tag} | ${value.value} | ${value.attempts} | ${value.successes} | ${percent(value.rate)} | ${interval(value.wilson95)} |`),
        '',
        '## Failures',
        '',
        `Categories: ${renderCounts(report.failureCategories)}`,
        '',
        `Stages: ${renderCounts(report.failedStages)}`,
        '',
        `Codes: ${renderCounts(report.failureCodes)}`,
        '',
    ];
    if (report.baselineComparison) {
        const comparison = report.baselineComparison;
        lines.push(
            '## Baseline Comparison: Treatment vs Controlled',
            '',
            '### Arm definitions and pairing evidence',
            '',
            '- **Rails treatment:** summaries declared `evaluationArm: "rails"`. Legacy candidate summaries with no arm field are accepted and treated as Rails.',
            '- **Controlled baseline:** summaries declared `evaluationArm: "baseline-controlled"`. Legacy baseline summaries with no arm field are accepted, but their provenance is explicitly unknown.',
            '- Attempts are paired only by exact `model + scenarioId + attempt`; modern pairs additionally require identical evaluation-definition provenance. Rates below use matched pairs; unmatched evidence is never folded into a paired denominator.',
            '',
            `Candidate provenance: ${renderProvenance(comparison.armProvenance.candidate)}.`,
            '',
            `Baseline provenance: ${renderProvenance(comparison.armProvenance.baseline)}.`,
            '',
            `Candidate evaluation endpoint(s): ${renderCodeValues(comparison.endpointProvenance.candidate)}.`,
            '',
            `Baseline evaluation endpoint(s): ${renderCodeValues(comparison.endpointProvenance.baseline)}.`,
            '',
            `Observed-model parity: **${comparison.modelProvenance.parity}**.`,
            '',
            `Evaluation-definition parity: **${comparison.evaluationDefinitionProvenance.parity}**.`,
            '',
            `Candidate definition provenance: ${renderEvaluationDefinitionProvenance(comparison.evaluationDefinitionProvenance.candidate)}.`,
            '',
            `Baseline definition provenance: ${renderEvaluationDefinitionProvenance(comparison.evaluationDefinitionProvenance.baseline)}.`,
            '',
            `Candidate model provenance: ${renderModelProvenance(comparison.modelProvenance.candidate)}.`,
            '',
            `Baseline model provenance: ${renderModelProvenance(comparison.modelProvenance.baseline)}.`,
            '',
            `Matched attempts: **${comparison.matchedAttempts}**. Unmatched candidate attempts: **${comparison.unmatchedCandidateAttempts}**. Unmatched baseline attempts: **${comparison.unmatchedBaselineAttempts}**.`,
            '',
            '### All-autonomous matched comparison',
            '',
            ...pairedOutcomeMarkdown(comparison.allAutonomous),
            '',
            '### Product-quality matched comparison',
            '',
            'A pair is in this denominator only when neither arm is classified as a harness or infrastructure failure. This keeps the comparison paired and makes asymmetric exclusions visible.',
            '',
            `Excluded matched pairs: ${comparison.productQuality.excludedPairs}; candidate exclusions: ${comparison.productQuality.candidateExcludedAttempts}; baseline exclusions: ${comparison.productQuality.baselineExcludedAttempts}.`,
            '',
            ...pairedOutcomeMarkdown(comparison.productQuality),
            '',
            '### Matched duration and usage',
            '',
            '| Metric | Candidate total | Baseline total | Total delta | Candidate paired average | Baseline paired average | Average delta |',
            '|---|---:|---:|---:|---:|---:|---:|',
            pairedValueRow('Duration (ms)', comparison.durationMs),
            pairedValueRow('Input tokens', comparison.usage.inputTokens),
            pairedValueRow('Output tokens', comparison.usage.outputTokens),
            pairedValueRow('Reasoning tokens', comparison.usage.reasoningTokens),
            pairedValueRow('Cache-read tokens', comparison.usage.cacheReadTokens),
            pairedValueRow('Nano AIU', comparison.usage.totalNanoAiu),
            '',
            '### Matched comparison by model',
            '',
            ...comparison.byModel.flatMap(value => [
                `#### ${value.model}`,
                '',
                ...pairedOutcomeMarkdown(value.allAutonomous),
                '',
                ...(value.productQuality ? [
                    'Product-quality pairs:',
                    '',
                    ...pairedOutcomeMarkdown(value.productQuality),
                    '',
                ] : []),
                '| Metric | Candidate total | Baseline total | Total delta | Candidate paired average | Baseline paired average | Average delta |',
                '|---|---:|---:|---:|---:|---:|---:|',
                pairedValueRow('Duration (ms)', value.durationMs),
                pairedValueRow('Input tokens', value.usage.inputTokens),
                pairedValueRow('Output tokens', value.usage.outputTokens),
                pairedValueRow('Reasoning tokens', value.usage.reasoningTokens),
                pairedValueRow('Cache-read tokens', value.usage.cacheReadTokens),
                pairedValueRow('Nano AIU', value.usage.totalNanoAiu),
                '',
            ]),
            '### Matched comparison by scenario',
            '',
            '| Scenario | All N | Rails rate | Baseline rate | Delta | Product N | Rails product rate | Baseline product rate | Product delta |',
            '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
            ...comparison.byScenario.map(value => groupedComparisonRow(value.scenarioId, value)),
            '',
            '### Matched comparison by tag',
            '',
            '| Tag | Value | All N | Rails rate | Baseline rate | Delta | Product N | Rails product rate | Baseline product rate | Product delta |',
            '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
            ...comparison.byTag.map(value =>
                groupedComparisonRow(value.tag, value, value.value)),
            '',
        );
    }
    return lines.join('\n');
}

function pairedOutcomeMarkdown(value: PairedOutcomeComparison): string[] {
    return [
        '| Rails-only wins | Baseline-only wins | Both pass | Both fail |',
        '|---:|---:|---:|---:|',
        `| ${value.railsOnlyWins} | ${value.baselineOnlyWins} | ${value.bothPass} | ${value.bothFail} |`,
        '',
        '| Metric | Rails | Baseline | Delta |',
        '|---|---:|---:|---:|',
        `| Autonomous success | ${rateFraction(value.candidateSuccess)} | ${rateFraction(value.baselineSuccess)} | ${percent(value.successRateDelta)} |`,
        `| First-pass success | ${rateFraction(value.candidateFirstPass)} | ${rateFraction(value.baselineFirstPass)} | ${percent(value.firstPassRateDelta)} |`,
        `| Recovered successes | ${value.candidateRecoveredSuccesses} | ${value.baselineRecoveredSuccesses} | ${signed(value.recoveredSuccessDelta)} |`,
    ];
}

function renderMeasuredValue(value: ReleaseGateResult['measuredValue']): string {
    if (value === null) {
        return 'missing';
    }
    if (typeof value === 'number') {
        return value >= -1 && value <= 1 ? formatPercent(value) : decimal(value);
    }
    return value;
}

function escapeTable(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderProvenance(value: ArmProvenance): string {
    return `expected \`${value.expectedArm}\`; ${value.declaredSummaries} declared summary(s), ${value.legacySummaries} legacy summary(s) without an arm field; status \`${value.provenance}\``;
}

function renderModelProvenance(value: ArmModelProvenance): string {
    const missing = [
        value.missingRequestedAttempts.length
            ? `missing requested-model evidence for ${value.missingRequestedAttempts.join(', ')}`
            : undefined,
        value.missingObservedAttempts.length
            ? `missing observed-model evidence for ${value.missingObservedAttempts.join(', ')}`
            : undefined,
    ].filter(part => part !== undefined);
    return `requested ${renderCodeValues(value.requestedModels)}; observed ${renderCodeValues(value.observedModels)}; `
        + `status \`${value.status}\`${missing.length ? ` (${missing.join('; ')})` : ''}`;
}

function renderEvaluationDefinitionProvenance(value: EvaluationDefinitionSummary): string {
    const missing = value.missingAttempts.length
        ? `; missing attempts ${value.missingAttempts.join(', ')}`
        : '';
    return `combined ${renderCodeValues(value.hashes)}; scenario corpus ${renderCodeValues(value.scenarioCorpusHashes)}; `
        + `evaluator ${renderCodeValues(value.evaluatorHashes)}; product contracts ${renderCodeValues(value.productContractHashes)}; `
        + `status \`${value.status}\`${missing}`;
}

function renderCodeValues(values: string[]): string {
    return values.length ? values.map(value => `\`${value}\``).join(', ') : 'none';
}

function pairedValueRow(label: string, value: PairedValueComparison): string {
    return `| ${label} | ${decimal(value.candidateTotal)} | ${decimal(value.baselineTotal)} | ${signedDecimal(value.totalDelta)} | ${decimal(value.candidateAverage)} | ${decimal(value.baselineAverage)} | ${signedDecimal(value.averageDelta)} |`;
}

function groupedComparisonRow(
    label: string,
    value: GroupedPairedComparison,
    secondLabel?: string,
): string {
    const product = value.productQuality;
    const prefix = secondLabel === undefined ? `| ${label}` : `| ${label} | ${secondLabel}`;
    return `${prefix} | ${value.allAutonomous.matchedAttempts} | ${percent(value.allAutonomous.candidateSuccess.rate)} | ${percent(value.allAutonomous.baselineSuccess.rate)} | ${percent(value.allAutonomous.successRateDelta)} | ${product?.matchedAttempts ?? 'N/A'} | ${percent(product?.candidateSuccess.rate ?? null)} | ${percent(product?.baselineSuccess.rate ?? null)} | ${percent(product?.successRateDelta ?? null)} |`;
}

function rateFraction(value: RateSummary): string {
    return `${value.successes}/${value.attempts} (${percent(value.rate)})`;
}

function decimal(value: number | null): string {
    return value === null ? 'N/A' : Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function signedDecimal(value: number | null): string {
    return value === null ? 'N/A' : `${value > 0 ? '+' : ''}${decimal(value)}`;
}

function signed(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}

function rateRow(label: string, value: RateSummary): string {
    return `| ${label} | ${value.attempts} | ${value.successes} | ${percent(value.rate)} | ${interval(value.wilson95)} |`;
}

function summarizeCounts(successes: number, attempts: number): RateSummary {
    return {
        attempts,
        successes,
        failures: attempts - successes,
        rate: attempts ? successes / attempts : null,
        wilson95: wilsonInterval(successes, attempts),
    };
}

function rateSummaryText(value: RateSummary): string {
    return `${value.successes}/${value.attempts} (${percent(value.rate)}, Wilson 95% ${interval(value.wilson95)})`;
}

function interval(value: WilsonInterval | null): string {
    return value ? `${percent(value.lower)}–${percent(value.upper)}` : 'N/A';
}

function percent(value: number | null): string {
    return value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
}

function renderCounts(values: Record<string, number>): string {
    const entries = Object.entries(values);
    return entries.length ? entries.map(([key, count]) => `${key}=${count}`).join(', ') : 'none';
}

function countValues(values: string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const value of values) {
        counts[value] = (counts[value] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function unique(values: string[]): string[] {
    return [...new Set(values)].sort();
}

function attemptKey(attempt: EvaluationAttempt): string {
    return `${attempt.scenarioId}:${attempt.attempt}`;
}

function assertUniqueRunIds(attempts: EvaluationAttempt[]): void {
    const seen = new Set<string>();
    for (const attempt of attempts) {
        if (seen.has(attempt.runId)) {
            throw new Error(`Duplicate run id in report inputs: ${attempt.runId}`);
        }
        seen.add(attempt.runId);
    }
}

function assertUniquePairingKeys(summaries: EvaluationSummary[], label: string): void {
    const seen = new Set<string>();
    for (const summary of summaries) {
        for (const attempt of summary.results) {
            const key = pairingKey(summary, attempt);
            if (seen.has(key)) {
                throw new Error(
                    `Ambiguous ${label} pairing key: ${summary.through}/${attemptKey(attempt)}`,
                );
            }
            seen.add(key);
        }
    }
}

function pairingKey(
    summary: EvaluationSummary | undefined,
    attempt: EvaluationAttempt,
): string {
    if (!summary) {
        throw new Error(`Internal report error resolving endpoint provenance for attempt ${attemptKey(attempt)}.`);
    }
    return `${summary.through}\0${attemptKey(attempt)}\0${reportModel(attempt, summary)}`;
}

async function loadSummaries(inputs: string[]): Promise<EvaluationSummary[]> {
    return await Promise.all(inputs.map(async input => {
        const resolved = path.resolve(input);
        const stat = await fs.stat(resolved);
        const summaryPath = stat.isDirectory() ? path.join(resolved, 'summary.json') : resolved;
        const parsed: unknown = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
        return validateSummary(parsed, summaryPath);
    }));
}

export async function loadVsCodeParityResults(inputs: string[]): Promise<SandboxVsCodeParityResult[]> {
    return await Promise.all(inputs.map(async input => {
        const resolved = path.resolve(input);
        const stat = await fs.stat(resolved);
        const resultPath = stat.isDirectory()
            ? path.join(resolved, 'vscode-parity-result.json')
            : resolved;
        const parsed: unknown = JSON.parse(await fs.readFile(resultPath, 'utf8'));
        if (
            !parsed
            || typeof parsed !== 'object'
            || !['passed', 'failed', 'skipped'].includes(
                (parsed as Partial<SandboxVsCodeParityResult>).outcome ?? '',
            )
        ) {
            throw new Error(`Invalid VS Code parity result: ${resultPath}`);
        }

        return parsed as SandboxVsCodeParityResult;
    }));
}

export async function loadDeploymentResults(inputs: string[]): Promise<LiveDeploymentResult[]> {
    return await Promise.all(inputs.map(async input => {
        const parsed: unknown = JSON.parse(await fs.readFile(path.resolve(input), 'utf8'));
        if (
            !parsed
            || typeof parsed !== 'object'
            || !['passed', 'failed'].includes((parsed as Partial<LiveDeploymentResult>).outcome ?? '')
            || typeof (parsed as Partial<LiveDeploymentResult>).cleanupVerified !== 'boolean'
        ) {
            throw new Error(`Invalid live deployment result: ${input}`);
        }
        return parsed as LiveDeploymentResult;
    }));
}

function validateSummary(value: unknown, file: string): EvaluationSummary {
    if (!value || typeof value !== 'object' || !Array.isArray((value as EvaluationSummary).results)) {
        throw new Error(`Invalid evaluation summary: ${file}`);
    }
    return value as EvaluationSummary;
}

function parseArgs(args: string[]): ReportOptions {
    const options: ReportOptions = {
        inputs: [],
        baselines: [],
        vscodeParityInputs: [],
        deploymentInputs: [],
        thresholdsPath: defaultReleaseThresholdsPath,
        outputDirectory: path.resolve('evals', 'results', 'report'),
    };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        switch (arg) {
            case '--input':
                options.inputs.push(requireValue(args, ++index, arg));
                break;
            case '--baseline':
                options.baselines.push(requireValue(args, ++index, arg));
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
    if (!options.inputs.length) {
        throw new Error('At least one --input summary file or directory is required.');
    }
    return options;
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
