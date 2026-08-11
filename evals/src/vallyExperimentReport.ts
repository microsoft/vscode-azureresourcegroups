/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import {
    VallyAdapterOptions,
    VallyAdapterReport,
    runVallyAdapter,
} from './vally';
import { defaultReleaseThresholdsPath } from './releaseThresholds';

type EvaluationArm = 'rails' | 'baseline-controlled';

interface ExperimentReportOptions {
    experimentDirectories: string[];
    vscodeParityInputs: string[];
    deploymentInputs: string[];
    thresholdsPath: string;
    outputDirectory: string;
    enforceRelease: boolean;
}

export interface VallyExperimentArtifactBundle {
    artifactDirectory: string;
    summaryPath: string;
    ownerLabel: string;
    runId: string;
    scenarioId: string;
    arm: EvaluationArm;
    endpoint: string;
    model: string;
    cleanupVerified: boolean;
}

export interface VallyExperimentInputManifest {
    schemaVersion: '1';
    source: 'vally-native-experiment-artifacts';
    experimentDirectories: string[];
    artifactBundles: VallyExperimentArtifactBundle[];
    treatmentInputs: string[];
    baselineInputs: string[];
    cleanupVerification: {
        verifiedBundles: number;
        missingBundles: number;
    };
}

export async function discoverVallyExperimentEvidence(
    experimentDirectories: string[],
    requireCleanupVerification = false,
): Promise<VallyExperimentInputManifest> {
    if (!experimentDirectories.length) {
        throw new Error('At least one --experiment-dir is required.');
    }
    const roots = experimentDirectories.map(value => path.resolve(value));
    const summaryPaths = (
        await Promise.all(roots.map(root => findArtifactSummaries(root)))
    ).flat().sort();
    if (!summaryPaths.length) {
        throw new Error(
            `No durable Vally native-summary.json artifacts were found under ${roots.join(', ')}.`,
        );
    }

    const bundles = await Promise.all(summaryPaths.map(loadArtifactBundle));
    const duplicateRunIds = duplicateValues(bundles.map(bundle => bundle.runId));
    if (duplicateRunIds.length) {
        throw new Error(`Duplicate Vally native runId values: ${duplicateRunIds.join(', ')}.`);
    }
    const missingCleanup = bundles.filter(bundle => !bundle.cleanupVerified);
    if (requireCleanupVerification && missingCleanup.length) {
        throw new Error(
            'Release enforcement requires post-sweep cleanup verification in every durable '
            + `validation manifest; missing for ${missingCleanup.map(bundle => bundle.runId).join(', ')}.`,
        );
    }

    return {
        schemaVersion: '1',
        source: 'vally-native-experiment-artifacts',
        experimentDirectories: roots,
        artifactBundles: bundles,
        treatmentInputs: bundles
            .filter(bundle => bundle.arm === 'rails')
            .map(bundle => bundle.summaryPath),
        baselineInputs: bundles
            .filter(bundle => bundle.arm === 'baseline-controlled')
            .map(bundle => bundle.summaryPath),
        cleanupVerification: {
            verifiedBundles: bundles.length - missingCleanup.length,
            missingBundles: missingCleanup.length,
        },
    };
}

export async function runVallyExperimentReport(
    options: ExperimentReportOptions,
): Promise<VallyAdapterReport> {
    const manifest = await discoverVallyExperimentEvidence(
        options.experimentDirectories,
        options.enforceRelease,
    );
    if (!manifest.treatmentInputs.length || !manifest.baselineInputs.length) {
        throw new Error('Vally experiment reporting requires both Rails and controlled-baseline artifacts.');
    }
    const adapterOptions: VallyAdapterOptions = {
        inputs: manifest.treatmentInputs,
        baselineInputs: manifest.baselineInputs,
        vscodeParityInputs: options.vscodeParityInputs,
        deploymentInputs: options.deploymentInputs,
        thresholdsPath: options.thresholdsPath,
        outputDirectory: options.outputDirectory,
    };
    const report = await runVallyAdapter(adapterOptions);
    const outputDirectory = path.resolve(options.outputDirectory);
    await Promise.all([
        fs.writeFile(
            path.join(outputDirectory, 'experiment-input-manifest.json'),
            `${JSON.stringify(manifest, null, 2)}\n`,
        ),
        fs.writeFile(
            path.join(outputDirectory, 'vally-native-report.json'),
            `${JSON.stringify({
                schemaVersion: '1',
                source: manifest.source,
                inputs: manifest,
                report,
            }, null, 2)}\n`,
        ),
        appendInputIntegrity(path.join(outputDirectory, 'report.md'), manifest),
    ]);
    if (options.enforceRelease && report.releaseAssessment.recommendation !== 'candidate') {
        throw new Error(
            `Release policy rejected Vally experiment evidence with recommendation `
            + `"${report.releaseAssessment.recommendation}".`,
        );
    }

    async function appendInputIntegrity(
        reportPath: string,
        manifest: VallyExperimentInputManifest,
    ): Promise<void> {
        const total = manifest.artifactBundles.length;
        const verified = manifest.cleanupVerification.verifiedBundles;
        const lines = [
            '',
            '## Vally-native input integrity',
            '',
            `Durable experiment bundles: **${total}**; Rails: **${manifest.treatmentInputs.length}**; `
                + `controlled baseline: **${manifest.baselineInputs.length}**.`,
            '',
            `Embedded post-sweep cleanup verification: **${verified}/${total}** bundles.`,
            '',
            verified === total
                ? 'Every accepted durable validation manifest records successful exact-owner cleanup.'
                : 'This evidence predates embedded post-sweep cleanup verification and cannot pass '
                    + '`--enforce-release`; external owner-label checks may support pilot diagnostics '
                    + 'but do not upgrade these bundles to release evidence.',
            '',
        ];
        await fs.appendFile(reportPath, lines.join('\n'));
    }
    return report;
}

async function findArtifactSummaries(root: string): Promise<string[]> {
    let stat;
    try {
        stat = await fs.stat(root);
    } catch (error) {
        throw new Error(`Cannot read Vally experiment directory ${root}.`, { cause: error });
    }
    if (!stat.isDirectory()) {
        throw new Error(`Vally experiment input is not a directory: ${root}.`);
    }
    const results: string[] = [];
    async function visit(directory: string): Promise<void> {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        await Promise.all(entries.map(async entry => {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(entryPath);
            } else if (
                entry.isFile()
                && entry.name === 'native-summary.json'
                && path.basename(directory) === 'artifacts'
            ) {
                results.push(entryPath);
            }
        }));
    }
    await visit(root);
    return results;
}

async function loadArtifactBundle(summaryPath: string): Promise<VallyExperimentArtifactBundle> {
    const artifactDirectory = path.dirname(summaryPath);
    const [summary, manifest, validation, metrics, runResult] = await Promise.all([
        readObject(summaryPath),
        readObject(path.join(artifactDirectory, 'validation-manifest.json')),
        readObject(path.join(artifactDirectory, 'cor-validation.json')),
        readObject(path.join(artifactDirectory, 'custom_metrics.json')),
        readObject(path.join(artifactDirectory, 'run-result.json')),
    ]);
    const selection = object(manifest.selection, `${summaryPath}: manifest.selection`);
    const native = object(manifest.native, `${summaryPath}: manifest.native`);
    const manifestValidation = object(
        manifest.validation,
        `${summaryPath}: manifest.validation`,
    );
    const identity = object(validation.identity, `${summaryPath}: validation.identity`);
    const metricsIdentity = object(metrics.identity, `${summaryPath}: metrics.identity`);
    const results = array(summary.results, `${summaryPath}: summary.results`);
    if (results.length !== 1) {
        throw new Error(`${summaryPath}: every Vally trial summary must contain exactly one result.`);
    }
    const result = object(results[0], `${summaryPath}: summary.results[0]`);
    const arm = requiredArm(selection.arm, `${summaryPath}: selection.arm`);
    const scenarioId = requiredString(selection.scenarioId, `${summaryPath}: selection.scenarioId`);
    const endpoint = requiredString(selection.endpoint, `${summaryPath}: selection.endpoint`);
    const model = requiredString(selection.model, `${summaryPath}: selection.model`);
    const runId = requiredString(native.runId, `${summaryPath}: native.runId`);
    const ownerLabel = requiredString(manifest.ownerLabel, `${summaryPath}: manifest.ownerLabel`);
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(ownerLabel)) {
        throw new Error(`${summaryPath}: manifest.ownerLabel is invalid.`);
    }
    const expected = { scenarioId, arm, endpoint, model, runId };
    assertFields(summaryPath, 'summary', summary, {
        evaluationArm: arm,
        through: endpoint,
    });
    assertOptionalField(summaryPath, 'summary', summary, 'requestedModel', model);
    assertFields(summaryPath, 'summary result', result, {
        evaluationArm: arm,
        scenarioId,
        runId,
        requestedModel: model,
    });
    assertFields(summaryPath, 'run-result', runResult, {
        evaluationArm: arm,
        scenarioId,
        runId,
        requestedModel: model,
    });
    assertFields(summaryPath, 'validation identity', identity, expected);
    assertFields(summaryPath, 'metrics identity', metricsIdentity, expected);
    if (manifest.schemaVersion !== '1' || manifest.executor !== 'cor-aca') {
        throw new Error(`${summaryPath}: unsupported Vally executor manifest.`);
    }

    function assertOptionalField(
        source: string,
        label: string,
        actual: Record<string, unknown>,
        name: string,
        expected: string,
    ): void {
        if (actual[name] !== undefined && actual[name] !== expected) {
            throw new Error(
                `${source}: ${label}.${name} must be "${expected}" when present, `
                + `found ${JSON.stringify(actual[name])}.`,
            );
        }
    }
    if (
        validation.schema !== 'copilot-on-rails-authoritative-validation/v1'
        || validation.schemaVersion !== 1
        || metrics.schema !== 'copilot-on-rails-authoritative-metrics/v1'
        || metrics.schemaVersion !== 1
    ) {
        throw new Error(`${summaryPath}: unsupported authoritative artifact schema.`);
    }
    return {
        artifactDirectory,
        summaryPath,
        ownerLabel,
        runId,
        scenarioId,
        arm,
        endpoint,
        model,
        cleanupVerified: manifestValidation.cleanupVerified === true,
    };
}

function assertFields(
    source: string,
    label: string,
    actual: Record<string, unknown>,
    expected: Record<string, string>,
): void {
    for (const [name, value] of Object.entries(expected)) {
        if (actual[name] !== value) {
            throw new Error(
                `${source}: ${label}.${name} must be "${value}", found ${JSON.stringify(actual[name])}.`,
            );
        }
    }
}

async function readObject(filePath: string): Promise<Record<string, unknown>> {
    let value: unknown;
    try {
        value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`Cannot read required Vally artifact ${filePath}.`, { cause: error });
    }
    return object(value, filePath);
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object.`);
    }
    return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new Error(`${label} must be an array.`);
    }
    return value;
}

function requiredString(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string.`);
    }
    return value;
}

function requiredArm(value: unknown, label: string): EvaluationArm {
    if (value !== 'rails' && value !== 'baseline-controlled') {
        throw new Error(`${label} must be "rails" or "baseline-controlled".`);
    }
    return value;
}

function duplicateValues(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) {
            duplicates.add(value);
        }
        seen.add(value);
    }
    return [...duplicates].sort();
}

function parseArgs(args: string[]): ExperimentReportOptions | 'help' {
    const options: ExperimentReportOptions = {
        experimentDirectories: [],
        vscodeParityInputs: [],
        deploymentInputs: [],
        thresholdsPath: defaultReleaseThresholdsPath,
        outputDirectory: path.join('evals', 'results', 'vally-native-report'),
        enforceRelease: false,
    };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '-h' || arg === '--help') {
            return 'help';
        }
        if (arg === '--enforce-release') {
            options.enforceRelease = true;
            continue;
        }
        const value = args[++index];
        if (!value) {
            throw new Error(`Missing value for ${arg}.`);
        }
        switch (arg) {
            case '--experiment-dir':
                options.experimentDirectories.push(value);
                break;
            case '--vscode-parity':
                options.vscodeParityInputs.push(value);
                break;
            case '--deployment':
                options.deploymentInputs.push(value);
                break;
            case '--thresholds':
                options.thresholdsPath = value;
                break;
            case '--output':
                options.outputDirectory = value;
                break;
            default:
                throw new Error(`Unknown argument "${arg}".`);
        }
    }
    return options;
}

function printHelp(): void {
    process.stdout.write([
        'Aggregate durable Vally-native experiment artifacts and apply release policy.',
        '',
        'Options:',
        '  --experiment-dir <dir>  Vally experiment output root (repeatable)',
        '  --vscode-parity <json>  Provenance-bound debugger result (repeatable)',
        '  --deployment <json>     Provenance-bound deployment result (repeatable)',
        '  --thresholds <json>     Versioned release thresholds',
        '  --output <dir>          Report output directory',
        '  --enforce-release       Exit non-zero unless every release gate passes',
        '  -h, --help              Show this help',
        '',
    ].join('\n'));
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (options === 'help') {
        printHelp();
        return;
    }
    await runVallyExperimentReport(options);
}

if (require.main === module) {
    void main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
