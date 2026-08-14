/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateDeploymentArtifacts } from './artifacts/deployment';
import { validateIntegrationPlanArtifact } from './artifacts/integrationPlan';
import { validateIntegrationOutput } from './artifacts/integrationOutput';
import { validateLocalDebugArtifacts } from './artifacts/localDebug';
import { validatePlanEvaluationContract } from './artifacts/planEvaluation';
import { validatePreviewArtifacts } from './artifacts/preview';
import { validateProjectPlanArtifact } from './artifacts/projectPlan';
import { validateRequirementsArtifact } from './artifacts/requirements';
import { ArtifactValidationResult } from './artifacts/validationTypes';
import { SandboxLocalRuntimeValidator } from './SandboxLocalRuntimeValidator';
import { discoverProjectValidationTargets, SandboxProjectValidator } from './SandboxProjectValidator';
import { CorEvaluationScenario, validateScenario } from './scenario';

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

const repoRoot = path.resolve(__dirname, '..', '..');
const manifestPath = path.join(repoRoot, 'evals', 'grader-certification', 'manifest.json');

async function main(): Promise<void> {
    const mode = process.argv.includes('--aca') ? 'aca' : 'offline';
    const outputIndex = process.argv.indexOf('--output');
    const outputDirectory = outputIndex >= 0
        ? path.resolve(process.argv[outputIndex + 1])
        : path.join(repoRoot, 'evals', 'results', 'grader-certification', mode);
    const caseIndex = process.argv.indexOf('--case');
    const caseFilter = caseIndex >= 0 ? process.argv[caseIndex + 1] : undefined;
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as CertificationManifest;
    if (manifest.schemaVersion !== 1) {
        throw new Error(`Unsupported grader certification manifest version ${manifest.schemaVersion}.`);
    }
    const fixture = path.join(repoRoot, manifest.fixture.path);
    const scenarioPath = path.join(fixture, 'scenario.json');
    const scenario = validateScenario(JSON.parse(await fs.readFile(scenarioPath, 'utf8')), scenarioPath);
    const cases = mode === 'offline'
        ? await runOfflineCertification(manifest, fixture, scenario)
        : await runAcaCertification(manifest, fixture, scenario, caseFilter);
    const report: CertificationReport = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        mode,
        fixture: manifest.fixture.id,
        outcome: cases.every(value => value.passed) ? 'passed' : 'failed',
        cases,
    };
    await fs.mkdir(outputDirectory, { recursive: true });
    await Promise.all([
        fs.writeFile(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`),
        fs.writeFile(path.join(outputDirectory, 'report.md'), renderMarkdown(report)),
    ]);
    console.log(`${report.outcome.toUpperCase()}: ${cases.filter(value => value.passed).length}/${cases.length} grader certification cases passed.`);
    if (report.outcome !== 'passed') {
        process.exitCode = 1;
    }
}

async function runOfflineCertification(
    manifest: CertificationManifest,
    fixture: string,
    scenario: CorEvaluationScenario,
): Promise<CertificationCase[]> {
    const cases: CertificationCase[] = [];
    const golden = await runOfflineValidators(fixture, scenario);
    for (const validator of manifest.fixture.offlineValidators) {
        const result = golden.get(validator) ?? ['validatorNotExecuted'];
        cases.push(createCase(`golden-${validator}`, 'offline', validator, 'passed', result));
    }
    for (const mutation of manifest.mutations.filter(value => value.tier === 'offline')) {
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

async function runAcaCertification(
    manifest: CertificationManifest,
    fixture: string,
    scenario: CorEvaluationScenario,
    caseFilter?: string,
): Promise<CertificationCase[]> {
    const cases: CertificationCase[] = [];
    const projectValidator = new SandboxProjectValidator(repoRoot);
    const localValidator = new SandboxLocalRuntimeValidator(repoRoot);
    const debugPlan = await fs.readFile(path.join(fixture, '.azure', 'vscode-debug-plan.md'), 'utf8');
    if (!caseFilter || caseFilter === 'golden-project-build') {
        const buildStart = Date.now();
        const build = await projectValidator.validate(fixture, scenario);
        cases.push({
            id: 'golden-project-build',
            tier: 'aca',
            validator: 'project-build',
            expected: 'passed',
            actual: [build.outcome, build.failureCode ?? 'none', build.error ?? ''],
            passed: build.outcome === 'passed',
            durationMs: Date.now() - buildStart,
        });
    }
    if (!caseFilter || caseFilter === 'golden-local-runtime') {
        const localStart = Date.now();
        const local = await localValidator.validate(fixture, scenario, debugPlan);
        const missingEvidence = missingGateEvidence(manifest.fixture.acaValidators, local);
        cases.push({
            id: 'golden-local-runtime',
            tier: 'aca',
            validator: 'local-runtime',
            expected: 'passed',
            actual: [
                ...localDetails(local),
                ...missingEvidence.map(value => `missing-evidence: ${value}`),
            ],
            passed: local.outcome === 'passed' && missingEvidence.length === 0,
            durationMs: Date.now() - localStart,
        });
    }
    for (const mutation of manifest.mutations.filter(value =>
        value.tier === 'aca' && (!caseFilter || caseFilter === value.id))) {
        cases.push(await withMutatedFixture(fixture, mutation, async workspace => {
            const startedAt = Date.now();
            if (mutation.validator === 'project-build') {
                const result = await projectValidator.validate(workspace, scenario);
                const failedCommand = result.commands.find(value => !value.success)?.command;
                return {
                    id: mutation.id,
                    tier: 'aca',
                    validator: mutation.validator,
                    expected: mutation.expectedCode,
                    actual: [result.failureCode ?? result.outcome, failedCommand ?? 'none'],
                    passed: result.failureCode === mutation.expectedCode
                        && (!mutation.expectedCommand || failedCommand === mutation.expectedCommand),
                    durationMs: Date.now() - startedAt,
                };
            }
            const mutatedScenario = mutation.operation === 'scenario-status'
                ? mutateExpectedStatus(scenario)
                : scenario;
            const result = await localValidator.validate(workspace, mutatedScenario, debugPlan);
            return {
                id: mutation.id,
                tier: 'aca',
                validator: mutation.validator,
                expected: mutation.expectedCode,
                actual: localDetails(result),
                passed: result.failureCode === mutation.expectedCode,
                durationMs: Date.now() - startedAt,
            };
        }));
    }
    if (caseFilter && cases.length === 0) {
        throw new Error(`Unknown ACA grader certification case "${caseFilter}".`);
    }
    return cases;
}

async function runOfflineValidators(
    workspace: string,
    scenario: CorEvaluationScenario,
): Promise<Map<string, string[]>> {
    const azure = path.join(workspace, '.azure');
    const [requirements, projectPlan, integrationPlan, debugPlan] = await Promise.all([
        fs.readFile(path.join(azure, 'requirements.json'), 'utf8'),
        fs.readFile(path.join(azure, 'project-plan.md'), 'utf8'),
        fs.readFile(path.join(azure, 'integration-plan.md'), 'utf8'),
        fs.readFile(path.join(azure, 'vscode-debug-plan.md'), 'utf8'),
    ]);
    const deploymentPlan = await fs.readFile(path.join(azure, 'deployment-plan.md'), 'utf8');
    const validations: Array<readonly [string, ArtifactValidationResult]> = await Promise.all([
        Promise.resolve(['requirements', validateRequirementsArtifact(requirements, { requireConfirmed: true })] as const),
        Promise.resolve(['project-plan', validateProjectPlanArtifact(projectPlan, { expectedStatus: 'Integrated' })] as const),
        Promise.resolve(['plan-gate', validatePlanEvaluationContract(true, true, {
            called: true,
            previewManifestPresentAtCall: true,
            previewHtmlFilesAtCall: [],
        })] as const),
        validatePreviewArtifacts(path.join(azure, '.preview-temp')).then(result => ['preview', result] as const),
        Promise.resolve(['integration-plan', validateIntegrationPlanArtifact(integrationPlan, { hasFrontend: true })] as const),
        validateIntegrationOutput(workspace, { hasFrontend: true }).then(result => ['integration-output', result] as const),
        validateLocalDebugArtifacts(workspace, debugPlan, { requireSuccessfulChecklist: true })
            .then(result => ['local-debug', result] as const),
        validateDeploymentArtifacts(workspace, deploymentPlan).then(result => ['deployment', result] as const),
    ]);
    const results = new Map(validations.map(([id, result]) => [id, issueCodes(result)]));
    const targets = await discoverProjectValidationTargets(workspace, scenario);
    results.set('target-discovery', targets.length ? [] : ['noBuildTargets']);
    return results;
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

function mutateExpectedStatus(scenario: CorEvaluationScenario): CorEvaluationScenario {
    return {
        ...scenario,
        acceptance: {
            ...scenario.acceptance,
            local: scenario.acceptance?.local && {
                ...scenario.acceptance.local,
                probes: scenario.acceptance.local.probes.map((probe, index) =>
                    index === 0 ? { ...probe, expectedStatus: 201 } : probe),
            },
        },
    };
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

/**
 * A golden case that only checks `outcome === 'passed'` cannot distinguish a gate that ran and
 * succeeded from one that never ran at all. Several gates skip themselves when their prerequisites
 * are absent, so the fixture must prove each declared validator produced evidence.
 */
function missingGateEvidence(
    validators: string[],
    result: {
        commands?: Array<{ kind?: string }>;
        probes?: Array<unknown>;
        browserChecks?: Array<{ journeyStatus?: string; accessibilityScanned?: boolean }>;
        persistenceChecks?: Array<{ skipped?: boolean }>;
        securityChecks?: Array<unknown>;
    },
): string[] {
    const missing: string[] = [];
    for (const validator of validators) {
        switch (validator) {
            case 'local-runtime':
                if (!(result.probes ?? []).length) {
                    missing.push('local-runtime produced no probe evidence');
                }
                break;
            case 'browser':
                if (!(result.browserChecks ?? []).some(value => value.journeyStatus === 'passed')) {
                    missing.push('browser produced no completed journey evidence');
                }
                break;
            case 'accessibility':
                if (!(result.browserChecks ?? []).some(value => value.accessibilityScanned)) {
                    missing.push('accessibility produced no scan evidence');
                }
                break;
            case 'persistence':
                if (!(result.persistenceChecks ?? []).some(value => !value.skipped)) {
                    missing.push('persistence produced no unskipped evidence');
                }
                break;
            case 'debugger-readiness':
                if (!(result.commands ?? []).some(value => value.kind === 'debugger')) {
                    missing.push('debugger-readiness produced no debugger evidence');
                }
                break;
            case 'security':
                if (!(result.securityChecks ?? []).length) {
                    missing.push('security produced no evidence');
                }
                break;
            default:
                break;
        }
    }
    return missing;
}

function localDetails(result: {
    outcome: string;
    failureCode?: string;
    error?: string;
    browserChecks?: Array<{ error?: string }>;
    persistenceChecks?: Array<{ error?: string }>;
}): string[] {
    return [
        result.outcome,
        result.failureCode ?? 'none',
        result.error ?? '',
        ...(result.browserChecks ?? []).flatMap(value => value.error ? [`browser: ${value.error}`] : []),
        ...(result.persistenceChecks ?? []).flatMap(value => value.error ? [`persistence: ${value.error}`] : []),
    ].filter(Boolean);
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
