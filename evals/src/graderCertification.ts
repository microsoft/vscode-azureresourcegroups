/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NON_VISUAL_APP_TYPES } from './artifacts/plannedProject.ts';
import type { PlanGateState } from './artifacts/planEvaluation.ts';
import { validatePlanEvaluationContract } from './artifacts/planEvaluation.ts';
import { validateDebugArtifacts } from './artifacts/debugArtifacts.ts';
import { validateDatastoreFidelity } from './artifacts/datastoreFidelity.ts';
import { validateFrontendScaffold } from './artifacts/frontendScaffold.ts';
import { validateIntegrationPlanArtifact } from './artifacts/integrationPlan.ts';
import { validateDebugLaunchConfiguration } from './artifacts/launchConfig.ts';
import { validateLocalDebugPlanArtifact } from './artifacts/localDebugPlan.ts';
import { validatePreviewArtifacts } from './artifacts/preview.ts';
import { validateProjectPlanArtifact } from './artifacts/projectPlan.ts';
import { validateRequirementsArtifact } from './artifacts/requirements.ts';
import { validateServiceFidelity } from './artifacts/serviceFidelity.ts';
import {
    validateAppStarts,
    validateCrudRoundTrip,
    validateFrontendApiWiring,
    validateFrontendServes,
    validateHealthEndpoint,
} from './runtime/runtimeGates.ts';
import { releaseRuntimeSessions } from './runtime/runtimeSession.ts';
import type { ArtifactValidationResult } from './artifacts/validationTypes.ts';
import type { CorEvaluationScenario } from './scenario.ts';
import { validateScenario } from './scenario.ts';

interface CertificationFixture {
    id: string;
    path: string;
    description: string;
    offlineValidators: string[];
    /**
     * Golden-case expectations other than "passed", keyed by validator id.
     *
     * A gate that answers "not applicable" needs its escape hatch certified like any other
     * verdict. Without this, the only expressible golden expectation is a clean pass — so a
     * fixture on an unsupported stack would certify green, which is indistinguishable from
     * the gate having silently approved it. Pinning the exact code here means that if
     * someone later makes unsupported stacks fall through to a pass, certification goes red.
     */
    offlineExpectations?: Record<string, string>;
}

interface CertificationManifest {
    schemaVersion: number;
    fixtures: CertificationFixture[];
    mutations: CertificationMutation[];
}

interface CertificationMutation {
    id: string;
    tier: 'offline' | 'aca';
    fixture: string;
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
    fixture: string;
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
    fixtures: string[];
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
    if (manifest.schemaVersion !== 2) {
        throw new Error(`Unsupported grader certification manifest version ${manifest.schemaVersion}.`);
    }
    const only = readValidatorFilter(manifest);
    const outputDirectory = outputIndex >= 0
        ? path.resolve(process.argv[outputIndex + 1])
        // A filtered run is not a certification of the grader set, so it must not
        // overwrite the report a full run produced.
        : path.join(repoRoot, 'evals', 'results', 'grader-certification', only ? 'offline-filtered' : 'offline');
    const cases: CertificationCase[] = [];
    for (const fixture of manifest.fixtures) {
        cases.push(...await certifyFixture(manifest, fixture, only));
    }
    const report: CertificationReport = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        mode: 'offline',
        fixtures: manifest.fixtures.map(value => value.id),
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
    const known = new Set(manifest.fixtures.flatMap(value => value.offlineValidators));
    const unknown = requested.filter(id => !known.has(id));
    if (unknown.length > 0) {
        throw new Error(`Unknown validator ${unknown.join(', ')}. Known validators: ${[...known].join(', ')}.`);
    }
    return new Set(requested);
}

/**
 * Certify one fixture against the validators it declares.
 *
 * Fixtures are scoped rather than universal because an artifact is only gradeable
 * against the project it describes: the debug plan names a service root, a runtime
 * and the scripts it expects to find, so grading it against a different application
 * asks whether one project's artifacts describe another's — a question with no
 * meaningful answer. `sample-agent-output` therefore certifies the planning and
 * scaffold contracts, and `reference-node-fullstack` certifies the local-debug ones
 * against the app they were generated for.
 */
async function certifyFixture(
    manifest: CertificationManifest,
    fixture: CertificationFixture,
    only: Set<string> | undefined,
): Promise<CertificationCase[]> {
    const validators = fixture.offlineValidators.filter(id => !only || only.has(id));
    const mutations = manifest.mutations.filter(value =>
        value.tier === 'offline'
        && value.fixture === fixture.id
        && (!only || only.has(value.validator)));
    if (validators.length === 0 && mutations.length === 0) {
        return [];
    }

    const root = path.join(repoRoot, fixture.path);
    const scenarioPath = path.join(root, 'scenario.json');
    const scenario = validateScenario(JSON.parse(await fs.readFile(scenarioPath, 'utf8')), scenarioPath);

    const cases: CertificationCase[] = [];
    // The golden run is done against a *copy* rather than the checked-in fixture. The
    // runtime gates exercise the app for real — the CRUD gate writes a record — and a
    // certification run must not leave changes in the repository it is certifying.
    const golden = await withFixtureCopy(root, workspace =>
        runOfflineValidators(workspace, scenario, fixture.offlineValidators));
    for (const validator of validators) {
        const result = golden.get(validator) ?? ['validatorNotExecuted'];
        const expected = fixture.offlineExpectations?.[validator] ?? 'passed';
        cases.push(createCase(`golden-${validator}`, 'offline', fixture.id, validator, expected, result));
    }
    for (const mutation of mutations) {
        cases.push(await withMutatedFixture(root, mutation, async workspace => {
            const results = await runOfflineValidators(workspace, scenario, fixture.offlineValidators);
            const actual = results.get(mutation.validator) ?? ['validatorNotExecuted'];
            return createCase(
                mutation.id,
                'offline',
                fixture.id,
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

/**
 * Every offline validator, keyed by the id the manifest uses.
 *
 * Each entry reads its own inputs, so a fixture that carries no `requirements.json`
 * — because it is a plain app rather than agent output — simply never asks for one.
 * Reading eagerly for all validators would make every fixture owe every artifact.
 */
const OFFLINE_VALIDATORS: Record<
    string,
    (workspace: string, scenario: CorEvaluationScenario) => Promise<ArtifactValidationResult>
> = {
    requirements: async workspace =>
        validateRequirementsArtifact(await readArtifact(workspace, '.azure/requirements.json'), { requireConfirmed: true }),
    'project-plan': async workspace =>
        validateProjectPlanArtifact(await readArtifact(workspace, '.azure/project-plan.md'), { expectedStatus: 'Integrated' }),
    'integration-plan': async (workspace, scenario) =>
        validateIntegrationPlanArtifact(await readArtifact(workspace, '.azure/integration-plan.md'), {
            hasFrontend: (scenario.tags.frontend ?? 'none') !== 'none',
        }),
    'plan-gate': async (workspace, scenario) => {
        const azure = path.join(workspace, '.azure');
        const projectPlan = await readArtifact(workspace, '.azure/project-plan.md');
        const state = await readPlanGateState(azure, scenario, projectPlan);
        return validatePlanEvaluationContract(state.expectedFrontend, state.generatedFrontend, state.gate);
    },
    preview: async workspace => validatePreviewArtifacts(path.join(workspace, '.azure', '.preview-temp')),
    'frontend-scaffold': async workspace => validateFrontendScaffold(workspace),
    'service-fidelity': async workspace =>
        validateServiceFidelity(workspace, await readArtifact(workspace, '.azure/project-plan.md')),
    'datastore-fidelity': async workspace =>
        validateDatastoreFidelity(workspace, await readArtifact(workspace, '.azure/project-plan.md')),
    'debug-plan': async workspace =>
        validateLocalDebugPlanArtifact(await readArtifact(workspace, '.azure/vscode-debug-plan.md'), {
            expectedStatus: 'Implemented',
            expectedServiceCount: 1,
            expectNoEmulators: true,
            requireChecklist: true,
        }),
    'debug-config': async workspace => validateDebugLaunchConfiguration(
        await readArtifact(workspace, '.vscode/launch.json'),
        await readArtifact(workspace, '.vscode/tasks.json'),
    ),
    'debug-artifacts': async workspace => validateDebugArtifacts(workspace),

    // The runtime gates. Unlike everything above, these start the application and probe it
    // over HTTP, so certifying them costs a real process launch per fixture copy — which is
    // the only way to certify a gate whose whole claim is that it ran the product.
    'runtime-app-starts': workspace => validateAppStarts(workspace),
    'runtime-health': workspace => validateHealthEndpoint(workspace),
    'runtime-frontend': workspace => validateFrontendServes(workspace),
    'runtime-frontend-api': workspace => validateFrontendApiWiring(workspace),
    'runtime-crud': workspace => validateCrudRoundTrip(workspace),
};

function readArtifact(workspace: string, relativePath: string): Promise<string> {
    return fs.readFile(path.join(workspace, ...relativePath.split('/')), 'utf8');
}

async function runOfflineValidators(
    workspace: string,
    scenario: CorEvaluationScenario,
    validators: string[],
): Promise<Map<string, string[]>> {
    const unknown = validators.filter(id => !(id in OFFLINE_VALIDATORS));
    if (unknown.length > 0) {
        throw new Error(`Manifest names validators with no implementation: ${unknown.join(', ')}.`);
    }
    try {
        const validations = await Promise.all(validators.map(async id =>
            [id, await OFFLINE_VALIDATORS[id](workspace, scenario)] as const));
        return new Map(validations.map(([id, result]) => [id, issueCodes(result)]));
    } finally {
        // The runtime validators leave a server running so they can share one start between
        // them. It has to be stopped here: the caller deletes this workspace immediately
        // afterwards, and deleting a directory out from under a live process is how a
        // machine acquires an orphan that holds a port and breaks every later run.
        await releaseRuntimeSessions();
    }
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
    const generatedFrontend = !!appType && !NON_VISUAL_APP_TYPES.includes(appType);
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

/**
 * Run `action` against a throwaway copy of a fixture.
 *
 * Needed because certification is no longer read-only: the runtime gates start the app and
 * a CRUD round-trip writes a record, so grading the checked-in tree directly would leave
 * the fixture dirty and make the next run's result depend on the last one's.
 */
async function withFixtureCopy<T>(fixture: string, action: (workspace: string) => Promise<T>): Promise<T> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-grader-certification-'));
    const workspace = path.join(root, path.basename(fixture));
    try {
        await fs.cp(fixture, workspace, { recursive: true });
        return await action(workspace);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
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
                // Recursive so a mutation can delete a whole service directory — "the plan
                // declared three services and the scaffold has two" is not expressible by
                // removing a single file.
                await fs.rm(filePath, { recursive: true });
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
    fixture: string,
    validator: string,
    expected: string,
    actual: string[],
): CertificationCase {
    return {
        id,
        tier,
        fixture,
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
        `- Fixtures: ${report.fixtures.map(value => `\`${value}\``).join(', ')}`,
        `- Outcome: **${report.outcome.toUpperCase()}**`,
        `- Cases: ${report.cases.filter(value => value.passed).length}/${report.cases.length} passed`,
        '',
        '| Case | Fixture | Validator | Expected | Actual | Result |',
        '|---|---|---|---|---|---|',
        ...report.cases.map(value =>
            `| \`${value.id}\` | \`${value.fixture}\` | \`${value.validator}\` | \`${value.expected}\` | \`${value.actual.join(', ') || 'passed'}\` | ${value.passed ? 'PASS' : 'FAIL'} |`),
        '',
    ];
    return `${lines.join('\n')}\n`;
}

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
