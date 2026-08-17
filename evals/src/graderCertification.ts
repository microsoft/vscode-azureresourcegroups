/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validatePlanEvaluationContract } from './artifacts/planEvaluation';
import { validatePreviewArtifacts } from './artifacts/preview';
import { validateProjectPlanArtifact } from './artifacts/projectPlan';
import { validateRequirementsArtifact } from './artifacts/requirements';
import { ArtifactValidationResult } from './artifacts/validationTypes';
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
    if (process.argv.includes('--aca')) {
        throw new Error('ACA certification is not available in the planning-only subset. Add scaffold/build/runtime graders first.');
    }
    const outputIndex = process.argv.indexOf('--output');
    const outputDirectory = outputIndex >= 0
        ? path.resolve(process.argv[outputIndex + 1])
        : path.join(repoRoot, 'evals', 'results', 'grader-certification', 'offline');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as CertificationManifest;
    if (manifest.schemaVersion !== 1) {
        throw new Error(`Unsupported grader certification manifest version ${manifest.schemaVersion}.`);
    }
    const fixture = path.join(repoRoot, manifest.fixture.path);
    const scenarioPath = path.join(fixture, 'scenario.json');
    const scenario = validateScenario(JSON.parse(await fs.readFile(scenarioPath, 'utf8')), scenarioPath);
    const cases = await runOfflineCertification(manifest, fixture, scenario);
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

// ACA certification is not included in the planning-only subset.
// It requires SandboxProjectValidator and SandboxLocalRuntimeValidator
// which will be added when scaffold/build/runtime graders are introduced.

async function runOfflineValidators(
    workspace: string,
    _scenario: CorEvaluationScenario,
): Promise<Map<string, string[]>> {
    const azure = path.join(workspace, '.azure');
    const [requirements, projectPlan] = await Promise.all([
        fs.readFile(path.join(azure, 'requirements.json'), 'utf8'),
        fs.readFile(path.join(azure, 'project-plan.md'), 'utf8'),
    ]);
    const validations: Array<readonly [string, ArtifactValidationResult]> = await Promise.all([
        Promise.resolve(['requirements', validateRequirementsArtifact(requirements, { requireConfirmed: true })] as const),
        Promise.resolve(['project-plan', validateProjectPlanArtifact(projectPlan, { expectedStatus: 'Integrated' })] as const),
        Promise.resolve(['plan-gate', validatePlanEvaluationContract(true, true, {
            called: true,
            previewManifestPresentAtCall: true,
            previewHtmlFilesAtCall: [],
        })] as const),
        validatePreviewArtifacts(path.join(azure, '.preview-temp')).then(result => ['preview', result] as const),
    ]);
    const results = new Map(validations.map(([id, result]) => [id, issueCodes(result)]));
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
