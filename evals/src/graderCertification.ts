/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PlanGateState } from './artifacts/planEvaluation.ts';
import { validateDebugArtifacts } from './artifacts/debugArtifacts.ts';
import { validateDebugLaunchConfiguration } from './artifacts/launchConfig.ts';
import { validateLocalDebugPlanArtifact } from './artifacts/localDebugPlan.ts';
import { validatePlanEvaluationContract } from './artifacts/planEvaluation.ts';
import { validatePreviewArtifacts } from './artifacts/preview.ts';
import { validateProjectPlanArtifact } from './artifacts/projectPlan.ts';
import { validateRequirementsArtifact } from './artifacts/requirements.ts';
import type { ArtifactValidationResult } from './artifacts/validationTypes.ts';
import type { CorEvaluationScenario } from './scenario.ts';
import { validateScenario } from './scenario.ts';

interface CertificationManifest {
    schemaVersion: number;
    fixture: {
        id: string;
        path: string;
        description: string;
        offlineValidators: string[];
        acaValidators: string[];
    };
    mutations: CertificationMutation[];
}

interface CertificationMutation {
    id: string;
    tier: 'offline' | 'aca';
    validator: string;
    file?: string;
    operation: 'replace' | 'append' | 'delete' | 'scenario-status';
    search?: string;
    replacement?: string;
    expectedCode: string;
    expectedCommand?: string;
}

interface CertificationCase {
    id: string;
    tier: 'offline' | 'aca';
    validator: string;
    expected: string;
    actual: string[];
    passed: boolean;
    durationMs: number;
}

interface CertificationReport {
    schemaVersion: 1;
    generatedAt: string;
    mode: 'offline' | 'aca';
    fixture: string;
    outcome: 'passed' | 'failed';
    cases: CertificationCase[];
}

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const manifestPath = path.join(repoRoot, 'evals', 'grader-certification', 'manifest.json');

async function main(): Promise<void> {
    if (process.argv.includes('--aca')) {
        throw new Error('ACA certification is not available in the planning-only subset. Add scaffold/build/runtime graders first.');
    }
    const outputIndex = process.argv.indexOf('--output');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as CertificationManifest;
    if (manifest.schemaVersion !== 1) {
        throw new Error(`Unsupported grader certification manifest version ${manifest.schemaVersion}.`);
    }
    const only = readValidatorFilter(manifest);
    const outputDirectory = outputIndex >= 0
        ? path.resolve(process.argv[outputIndex + 1])
        // A filtered run is not a certification of the grader set, so it must not
        // overwrite the report a full run produced.
        : path.join(repoRoot, 'evals', 'results', 'grader-certification', only ? 'offline-filtered' : 'offline');
    const fixture = path.join(repoRoot, manifest.fixture.path);
    const scenarioPath = path.join(fixture, 'scenario.json');
    const scenario = validateScenario(JSON.parse(await fs.readFile(scenarioPath, 'utf8')), scenarioPath);
    const cases = await runOfflineCertification(manifest, fixture, scenario, only);
    const report: CertificationReport = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        mode: 'offline',
        fixture: manifest.fixture.id,
        outcome: cases.every(value => value.passed) ? 'passed' : 'failed',
        cases,
    };
    await fs.mkdir(outputDirectory, { recursive: true });
    await Promise.all([
        fs.writeFile(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`),
        fs.writeFile(path.join(outputDirectory, 'report.md'), renderMarkdown(report)),
    ]);
    console.log(`${report.outcome.toUpperCase()}: ${cases.filter(value => value.passed).length}/${cases.length} grader certification cases passed${only ? ` (filtered to ${[...only].join(', ')})` : ''}.`);
    if (report.outcome !== 'passed') {
        process.exitCode = 1;
    }
}

/**
 * `--validator <id>` (repeatable) narrows certification to one grader while you are
 * iterating on it. The full set still runs in CI, so a filter can only make a local
 * run smaller — never make a failing grader look certified.
 */
function readValidatorFilter(manifest: CertificationManifest): Set<string> | undefined {
    const requested = process.argv.flatMap((argument, index) =>
        argument === '--validator' && process.argv[index + 1] ? [process.argv[index + 1]] : []);
    if (requested.length === 0) {
        return undefined;
    }
    const known = new Set(manifest.fixture.offlineValidators);
    const unknown = requested.filter(id => !known.has(id));
    if (unknown.length > 0) {
        throw new Error(`Unknown validator ${unknown.join(', ')}. Known validators: ${[...known].join(', ')}.`);
    }
    return new Set(requested);
}

async function runOfflineCertification(
    manifest: CertificationManifest,
    fixture: string,
    scenario: CorEvaluationScenario,
    only: Set<string> | undefined,
): Promise<CertificationCase[]> {
    const cases: CertificationCase[] = [];
    const golden = await runOfflineValidators(fixture, scenario);
    for (const validator of manifest.fixture.offlineValidators.filter(id => !only || only.has(id))) {
        const result = golden.get(validator) ?? ['validatorNotExecuted'];
        cases.push(createCase(`golden-${validator}`, 'offline', validator, 'passed', result));
    }
    const mutations = manifest.mutations.filter(value =>
        value.tier === 'offline' && (!only || only.has(value.validator)));
    for (const mutation of mutations) {
        cases.push(await withMutatedFixture(fixture, mutation, async workspace => {
            const results = await runOfflineValidators(workspace, scenario);
            const actual = results.get(mutation.validator) ?? ['validatorNotExecuted'];
            return createCase(
                mutation.id,
                'offline',
                mutation.validator,
                mutation.expectedCode,
                actual,
            );
        }));
    }
    return cases;
}

// ACA certification is not included in the planning-only subset.
// It requires SandboxProjectValidator and SandboxLocalRuntimeValidator
// which will be added when scaffold/build/runtime graders are introduced.

async function runOfflineValidators(
    workspace: string,
    scenario: CorEvaluationScenario,
): Promise<Map<string, string[]>> {
    const azure = path.join(workspace, '.azure');
    const [requirements, projectPlan, debugPlan] = await Promise.all([
        fs.readFile(path.join(azure, 'requirements.json'), 'utf8'),
        fs.readFile(path.join(azure, 'project-plan.md'), 'utf8'),
        fs.readFile(path.join(azure, 'vscode-debug-plan.md'), 'utf8'),
    ]);
    const launchText = await fs.readFile(path.join(workspace, '.vscode', 'launch.json'), 'utf8');
    const tasksText = await fs.readFile(path.join(workspace, '.vscode', 'tasks.json'), 'utf8');
    const validations: Array<readonly [string, ArtifactValidationResult]> = await Promise.all([
        Promise.resolve(['requirements', validateRequirementsArtifact(requirements, { requireConfirmed: true })] as const),
        Promise.resolve(['project-plan', validateProjectPlanArtifact(projectPlan, { expectedStatus: 'Integrated' })] as const),
        readPlanGateState(azure, scenario, projectPlan).then(state => [
            'plan-gate',
            validatePlanEvaluationContract(state.expectedFrontend, state.generatedFrontend, state.gate),
        ] as const),
        validatePreviewArtifacts(path.join(azure, '.preview-temp')).then(result => ['preview', result] as const),
        Promise.resolve(['debug-plan', validateLocalDebugPlanArtifact(debugPlan, {
            expectedStatus: 'Implemented',
            expectedServiceCount: 1,
            expectNoEmulators: true,
            requireChecklist: true,
        })] as const),
        Promise.resolve(['debug-config', validateDebugLaunchConfiguration(launchText, tasksText)] as const),
        validateDebugArtifacts(workspace).then(result => ['debug-artifacts', result] as const),
    ]);
    const results = new Map(validations.map(([id, result]) => [id, issueCodes(result)]));
    return results;
}

/**
 * Derive the plan-gate inputs from the fixture rather than hard-coding them.
 *
 * Passing literals made this validator unfalsifiable — it returned `valid: true`
 * for every fixture and every mutation, so certification proved nothing about it.
 * Reading the scenario, the plan and the preview directory means a mutation to any
 * of the three now changes the outcome.
 */
async function readPlanGateState(
    azureDir: string,
    scenario: CorEvaluationScenario,
    projectPlan: string,
): Promise<{ expectedFrontend: boolean; generatedFrontend: boolean; gate: PlanGateState }> {
    const expectedFrontend = (scenario.tags.frontend ?? 'none') !== 'none';
    const appType = /^\*\*App Type\*\*\s*:\s*(.+)$/im.exec(projectPlan)?.[1].trim().toLowerCase();
    const generatedFrontend = !!appType && !['api only', 'background worker'].includes(appType);
    return {
        expectedFrontend,
        generatedFrontend,
        gate: {
            called: true,
            previewManifestPresentAtCall: await exists(path.join(azureDir, '.preview-temp', 'manifest.json')),
            // The fixture is the post-gate state, so no HTML is treated as
            // pre-rendered; ordering is asserted from trajectories, not from disk.
            previewHtmlFilesAtCall: [],
        },
    };
}

async function exists(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

async function withMutatedFixture<T>(
    fixture: string,
    mutation: CertificationMutation,
    action: (workspace: string) => Promise<T>,
): Promise<T> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-grader-certification-'));
    const workspace = path.join(root, path.basename(fixture));
    try {
        await fs.cp(fixture, workspace, { recursive: true });
        if (mutation.file) {
            const filePath = path.join(workspace, mutation.file);
            if (mutation.operation === 'delete') {
                await fs.rm(filePath);
            } else {
                const content = await fs.readFile(filePath, 'utf8');
                if (mutation.operation === 'replace') {
                    if (!mutation.search || !content.includes(mutation.search)) {
                        throw new Error(`Mutation ${mutation.id} search text was not found.`);
                    }
                    await fs.writeFile(filePath, content.replace(mutation.search, mutation.replacement ?? ''));
                } else if (mutation.operation === 'append') {
                    await fs.writeFile(filePath, `${content}${mutation.replacement ?? ''}`);
                }
            }
        }
        return await action(workspace);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
}

function issueCodes(result: ArtifactValidationResult): string[] {
    return result.issues.map(value => value.code);
}

function createCase(
    id: string,
    tier: 'offline' | 'aca',
    validator: string,
    expected: string,
    actual: string[],
): CertificationCase {
    return {
        id,
        tier,
        validator,
        expected,
        actual,
        passed: expected === 'passed' ? actual.length === 0 : actual.includes(expected),
        durationMs: 0,
    };
}

function renderMarkdown(report: CertificationReport): string {
    const lines = [
        '# Copilot on Rails Grader Certification',
        '',
        `- Mode: \`${report.mode}\``,
        `- Fixture: \`${report.fixture}\``,
        `- Outcome: **${report.outcome.toUpperCase()}**`,
        `- Cases: ${report.cases.filter(value => value.passed).length}/${report.cases.length} passed`,
        '',
        '| Case | Validator | Expected | Actual | Result |',
        '|---|---|---|---|---|',
        ...report.cases.map(value =>
            `| \`${value.id}\` | \`${value.validator}\` | \`${value.expected}\` | \`${value.actual.join(', ') || 'passed'}\` | ${value.passed ? 'PASS' : 'FAIL'} |`),
        '',
    ];
    return `${lines.join('\n')}\n`;
}

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
