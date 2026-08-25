/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

export interface ReleaseThresholds {
    schemaVersion: '1';
    thresholdSet: string;
    evidence: {
        minimumScenarioCoverage: number;
        minimumAttemptsPerModelScenario: number;
    };
    criticalFailures: {
        maximumCount: number;
        failureCodes: string[];
    };
    outcomes: {
        minimumFinalSuccessRate: number;
        minimumFirstPassSuccessRate: number;
    };
    ui: {
        minimumBrowserSuccessRate: number;
        minimumAccessibilityScanCoverage: number;
        maximumSeriousOrCriticalViolations: number;
    };
    sideEffects: {
        minimumPersistenceSuccessRate: number;
        minimumWorkerSuccessRate: number;
    };
    debugger: {
        minimumRuns: number;
        minimumSuccessRate: number;
    };
    deployment: {
        minimumRuns: number;
        minimumSuccessRate: number;
        minimumCleanupCoverage: number;
    };
    baseline: {
        required: boolean;
        minimumMatchedPairCoverage: number;
        minimumPairsPerModelScenario: number;
        minimumFinalSuccessRateDelta: number;
        minimumFirstPassSuccessRateDelta: number;
    };
    efficiency: {
        maximumLatencyMultiplier: number;
        maximumCostMultiplier: number;
        costMetric: 'totalNanoAiu';
    };
    provenance: {
        requireDeclaredArms: boolean;
        requireAttemptCommitAndAssetHash: boolean;
        requireRequestedAndObservedModel: boolean;
        requireEvaluationDefinitionHash: boolean;
        requireCleanupEvidence: boolean;
    };
}

export const defaultReleaseThresholdsPath = path.join('evals', 'release-thresholds.v1.json');

export function loadReleaseThresholds(filePath = defaultReleaseThresholdsPath): ReleaseThresholds {
    const resolved = path.resolve(filePath);
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(resolved, 'utf8'));
    } catch (error) {
        throw new Error(
            `Cannot read release thresholds from ${resolved}: ${getErrorMessage(error)}`,
            { cause: error },
        );
    }
    return validateReleaseThresholds(parsed, resolved);
}

export function validateReleaseThresholds(value: unknown, source = 'release thresholds'): ReleaseThresholds {
    const root = object(value, source);
    if (root.schemaVersion !== '1') {
        throw new Error(`${source}: schemaVersion must be "1".`);
    }
    nonEmptyString(root.thresholdSet, `${source}.thresholdSet`);
    const evidence = section(root, 'evidence', source);
    rate(evidence.minimumScenarioCoverage, `${source}.evidence.minimumScenarioCoverage`);
    positiveInteger(evidence.minimumAttemptsPerModelScenario, `${source}.evidence.minimumAttemptsPerModelScenario`);

    const critical = section(root, 'criticalFailures', source);
    nonNegativeInteger(critical.maximumCount, `${source}.criticalFailures.maximumCount`);
    stringArray(critical.failureCodes, `${source}.criticalFailures.failureCodes`);

    const outcomes = section(root, 'outcomes', source);
    rate(outcomes.minimumFinalSuccessRate, `${source}.outcomes.minimumFinalSuccessRate`);
    rate(outcomes.minimumFirstPassSuccessRate, `${source}.outcomes.minimumFirstPassSuccessRate`);

    const ui = section(root, 'ui', source);
    rate(ui.minimumBrowserSuccessRate, `${source}.ui.minimumBrowserSuccessRate`);
    rate(ui.minimumAccessibilityScanCoverage, `${source}.ui.minimumAccessibilityScanCoverage`);
    nonNegativeInteger(ui.maximumSeriousOrCriticalViolations, `${source}.ui.maximumSeriousOrCriticalViolations`);

    const sideEffects = section(root, 'sideEffects', source);
    rate(sideEffects.minimumPersistenceSuccessRate, `${source}.sideEffects.minimumPersistenceSuccessRate`);
    rate(sideEffects.minimumWorkerSuccessRate, `${source}.sideEffects.minimumWorkerSuccessRate`);

    const debuggerThresholds = section(root, 'debugger', source);
    positiveInteger(debuggerThresholds.minimumRuns, `${source}.debugger.minimumRuns`);
    rate(debuggerThresholds.minimumSuccessRate, `${source}.debugger.minimumSuccessRate`);

    const deployment = section(root, 'deployment', source);
    positiveInteger(deployment.minimumRuns, `${source}.deployment.minimumRuns`);
    rate(deployment.minimumSuccessRate, `${source}.deployment.minimumSuccessRate`);
    rate(deployment.minimumCleanupCoverage, `${source}.deployment.minimumCleanupCoverage`);

    const baseline = section(root, 'baseline', source);
    boolean(baseline.required, `${source}.baseline.required`);
    rate(baseline.minimumMatchedPairCoverage, `${source}.baseline.minimumMatchedPairCoverage`);
    positiveInteger(baseline.minimumPairsPerModelScenario, `${source}.baseline.minimumPairsPerModelScenario`);
    delta(baseline.minimumFinalSuccessRateDelta, `${source}.baseline.minimumFinalSuccessRateDelta`);
    delta(baseline.minimumFirstPassSuccessRateDelta, `${source}.baseline.minimumFirstPassSuccessRateDelta`);

    const efficiency = section(root, 'efficiency', source);
    positiveNumber(efficiency.maximumLatencyMultiplier, `${source}.efficiency.maximumLatencyMultiplier`);
    positiveNumber(efficiency.maximumCostMultiplier, `${source}.efficiency.maximumCostMultiplier`);
    if (efficiency.costMetric !== 'totalNanoAiu') {
        throw new Error(`${source}.efficiency.costMetric must be "totalNanoAiu".`);
    }

    const provenance = section(root, 'provenance', source);
    for (const name of [
        'requireDeclaredArms',
        'requireAttemptCommitAndAssetHash',
        'requireRequestedAndObservedModel',
        'requireEvaluationDefinitionHash',
        'requireCleanupEvidence',
    ]) {
        boolean(provenance[name], `${source}.provenance.${name}`);
    }
    return value as ReleaseThresholds;
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object.`);
    }
    return value as Record<string, unknown>;
}

function section(root: Record<string, unknown>, name: string, source: string): Record<string, unknown> {
    return object(root[name], `${source}.${name}`);
}

function nonEmptyString(value: unknown, label: string): void {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string.`);
    }
}

function stringArray(value: unknown, label: string): void {
    if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== 'string' || !item.trim())) {
        throw new Error(`${label} must be a non-empty array of non-empty strings.`);
    }
    if (new Set(value).size !== value.length) {
        throw new Error(`${label} must not contain duplicates.`);
    }
}

function boolean(value: unknown, label: string): void {
    if (typeof value !== 'boolean') {
        throw new Error(`${label} must be a boolean.`);
    }
}

function rate(value: unknown, label: string): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`${label} must be a number from 0 to 1.`);
    }
}

function delta(value: unknown, label: string): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) {
        throw new Error(`${label} must be a number from -1 to 1.`);
    }
}

function positiveNumber(value: unknown, label: string): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${label} must be a positive number.`);
    }
}

function positiveInteger(value: unknown, label: string): void {
    if (!Number.isInteger(value) || (value as number) < 1) {
        throw new Error(`${label} must be a positive integer.`);
    }
}

function nonNegativeInteger(value: unknown, label: string): void {
    if (!Number.isInteger(value) || (value as number) < 0) {
        throw new Error(`${label} must be a non-negative integer.`);
    }
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] === import.meta.filename) {
    try {
        const thresholds = loadReleaseThresholds(process.argv[2]);
        process.stdout.write(`Valid release thresholds: ${thresholds.thresholdSet}\n`);
    } catch (error) {
        console.error(getErrorMessage(error));
        process.exitCode = 1;
    }
}
