/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/naming-convention -- fixtures intentionally match executor artifact schemas. */
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test registrations are intentionally top-level. */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { promisify } from 'node:util';
import { computeMetrics, createGraderRegistry, type GraderResult, type Trajectory } from '@microsoft/vally';
import {
    AUTHORITATIVE_SCHEMA,
    CorAuthoritativeGrader,
    CUSTOM_METRICS_SCHEMA,
    GATE_GROUPS,
    registerGraders,
} from '../vally/plugins/cor-graders/index';

const scratchRoot = path.resolve(`evals/results/vally-native-grader-test-${process.pid}`);
const execFileAsync = promisify(execFile);
const allGates = Object.values(GATE_GROUPS).flat() as string[];
const requiredGates = [
    'planning',
    'scaffold',
    'build',
    'test',
    'integration',
    'local-runtime',
    'cleanup',
    'model',
    'provenance',
];

describe('cor-authoritative Vally grader', () => {
    before(async () => {
        await fs.rm(scratchRoot, { recursive: true, force: true });
        await fs.mkdir(scratchRoot, { recursive: true });
    });

    after(async () => {
        await fs.rm(scratchRoot, { recursive: true, force: true });
    });

    test('registers the plugin and returns hierarchical passing evidence', async () => {
        const registry = createGraderRegistry();
        registerGraders(registry);
        assert.ok(registry.get('cor-authoritative'));
        assert.equal(
            new CorAuthoritativeGrader().metadata.behavior.requiresWorkspace,
            false,
            'artifactDir access is distinct from generated-workspace access in Vally 0.12',
        );

        const fixture = await writeEvidence('passing');
        const result = await grade(fixture);
        assert.equal(result.passed, true);
        assert.equal(result.score, 1);
        assert.deepEqual(result.details?.map(detail => detail.name), [
            'product',
            'runtime',
            'operations',
            'identity',
        ]);
        assert.equal(result.metadata?.evidenceTier, 'ordinary');
        assert.equal(result.metadata?.comparisonEligible, undefined);
    });

    test('loads the CommonJS bridge through Vally under plain Node', async () => {
        const bridge = path.resolve('evals/vally/plugins/cor-graders/index.js');
        const script = [
            'import { createGraderRegistry, loadGraderPlugin } from "@microsoft/vally";',
            'const registry = createGraderRegistry();',
            `await loadGraderPlugin(${JSON.stringify(bridge)}, registry);`,
            'if (!registry.get("cor-authoritative")) process.exit(2);',
            'process.stdout.write("cor-authoritative");',
        ].join('\n');
        const result = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
            cwd: path.resolve('.'),
        });
        assert.equal(result.stdout, 'cor-authoritative');
    });

    test('fails closed for a required failure and normalizes the hard gate to zero', async () => {
        const fixture = await writeEvidence('failed', evidence => {
            evidence.validation.diagnosticSummary = 'Build failed: npm run build exited with code 1.';
            evidence.validation.gates.build = {
                status: 'failed',
                evidence: ['reports/build.log'],
                reason: 'npm run build exited with code 1.',
            };
            evidence.metrics.values.build_status = 'failed';
            evidence.metrics.values.build_success = false;
            evidence.metrics.values.authoritative_hard_gates_passed = false;
        });
        const result = await grade(fixture);
        assert.equal(result.passed, false);
        assert.equal(result.score, 0);
        assert.equal(result.metadata?.hardGateNormalized, true);
        assert.match(findDetail(result, 'build').evidence, /npm run build exited with code 1/);
        assert.match(result.evidence, /Build failed: npm run build exited with code 1/);
        assert.match(result.evidence, /reports\/run-diagnostics\.md/);
    });

    test('distinguishes explicit non-applicability from required non-applicability', async () => {
        const fixture = await writeEvidence('not-applicable');
        const passing = await grade(fixture);
        assert.equal(findDetail(passing, 'browser').passed, true);
        assert.match(findDetail(passing, 'browser').evidence, /not applicable/);

        const required = await grade(fixture, [...requiredGates, 'browser']);
        assert.equal(required.passed, false);
        assert.equal(required.score, 0);
        assert.match(findDetail(required, 'browser').evidence, /status must be passed/);
    });

    test('fails closed for missing and malformed strict artifacts without workspace fallback', async () => {
        const fixture = await writeEvidence('strict-missing');
        const staleWorkspace = path.join(fixture.root, 'workspace');
        await fs.mkdir(staleWorkspace);
        await Promise.all([
            fs.copyFile(
                path.join(fixture.artifactDir, 'cor-validation.json'),
                path.join(staleWorkspace, 'cor-validation.json'),
            ),
            fs.copyFile(
                path.join(fixture.artifactDir, 'custom_metrics.json'),
                path.join(staleWorkspace, 'custom_metrics.json'),
            ),
        ]);
        await fs.rm(path.join(fixture.artifactDir, 'custom_metrics.json'));

        const missing = await grade({ ...fixture, workDir: staleWorkspace });
        assert.equal(missing.passed, false);
        assert.equal(missing.score, 0);
        assert.match(missing.evidence, /could not be read/);

        await fs.writeFile(path.join(fixture.artifactDir, 'custom_metrics.json'), '{broken');
        const malformed = await grade({ ...fixture, workDir: staleWorkspace });
        assert.equal(malformed.passed, false);
        assert.match(malformed.evidence, /malformed JSON/);
    });

    test('rejects identity, observed model, and exact provenance mismatches', async () => {
        const identityFixture = await writeEvidence('identity-mismatch', evidence => {
            evidence.validation.identity.scenarioId = 'wrong-scenario';
        });
        const identity = await grade(identityFixture);
        assert.equal(identity.passed, false);
        assert.match(findDetail(identity, 'provenance').evidence, /identity scenarioId/);

        const provenanceFixture = await writeEvidence('provenance-mismatch', evidence => {
            evidence.metrics.provenance.candidateCommit = 'different-commit';
        });
        const provenance = await grade(provenanceFixture);
        assert.equal(provenance.passed, false);
        assert.match(
            findDetail(provenance, 'provenance').evidence,
            /provenance must match exactly/,
        );

        const observedModel = await grade(identityFixture, requiredGates, {
            observedModels: ['different-model'],
        });
        assert.equal(observedModel.passed, false);
        assert.match(findDetail(observedModel, 'model').evidence, /observed trajectory model/);
    });

    test('requires explicit deployment authorization and rejects deployment for ordinary local trials', async () => {
        const fixture = await writeEvidence('deployment-tier');
        await assert.rejects(
            grade(fixture, [...requiredGates, 'deployment']),
            /deployment-authorized/,
        );
    });

    test('does not release-qualify historical evidence with missing provenance', async () => {
        const fixture = await writeEvidence('missing-provenance', evidence => {
            delete evidence.validation.provenance.evaluationDefinitionHash;
            delete evidence.metrics.provenance.evaluationDefinitionHash;
        });
        const result = await grade(fixture);
        assert.equal(result.passed, false);
        assert.equal(result.score, 0);
        assert.match(findDetail(result, 'provenance').evidence, /must be a non-empty string/);
    });

    test('rejects unsupported artifact schema versions', async () => {
        const fixture = await writeEvidence('schema-mismatch', evidence => {
            evidence.validation.schemaVersion = 2;
            evidence.metrics.schema = 'copilot-on-rails-authoritative-metrics/v0';
        });
        const result = await grade(fixture);
        assert.equal(result.passed, false);
        assert.equal(result.score, 0);
        assert.match(result.evidence, /schemaVersion must be 1|artifact schema must be/);
    });

    /*
     * Negative controls for the gates that have never once failed in production.
     *
     * Across the two most recent 20-scenario matrix runs, `model`, `provenance`, and `cleanup`
     * each recorded 40 passes and 0 failures. `planning` shares that record but is covered by
     * three mutations in grader-certification/manifest.json, so its clean sheet is credible.
     * These three had no negative control anywhere, which means we had no evidence they could
     * detect anything at all -- and they are the gates it is most dangerous to be wrong about.
     * `cleanup` silently passing means leaked Azure resources billing real money; `model` and
     * `provenance` silently passing means every number in the report is unverifiable.
     */

    test('the model gate fails when the artifact disagrees with the trajectory about the model', async () => {
        const fixture = await writeEvidence('model-negative-control', evidence => {
            evidence.validation.identity.model = 'claude-sonnet-5';
            evidence.metrics.identity.model = 'claude-sonnet-5';
        });
        const result = await grade(fixture);
        assert.equal(result.passed, false, 'a run cannot pass while misreporting which model produced it');
        assert.equal(findDetail(result, 'model').passed, false);
    });

    test('the provenance gate fails when the artifacts disagree about the candidate commit', async () => {
        const fixture = await writeEvidence('provenance-negative-control', evidence => {
            evidence.metrics.provenance.candidateCommit = 'tampered-commit';
        });
        const result = await grade(fixture);
        assert.equal(result.passed, false);
        assert.equal(findDetail(result, 'provenance').passed, false);
    });

    test('the cleanup gate fails when cleanup is reported failed', async () => {
        const fixture = await writeEvidence('cleanup-negative-control', evidence => {
            evidence.validation.gates.cleanup = {
                status: 'failed',
                evidence: ['reports/cleanup.json'],
                reason: 'Sandbox owner label still returned 1 sandbox after the sweep.',
            };
            evidence.metrics.values.cleanup_status = 'failed';
            evidence.metrics.values.cleanup_success = false;
            evidence.metrics.values.authoritative_hard_gates_passed = false;
        });
        const result = await grade(fixture);
        assert.equal(result.passed, false, 'leaked sandboxes must never be scored as a clean run');
        assert.equal(findDetail(result, 'cleanup').passed, false);
    });

    test('the cleanup gate fails closed when its evidence is missing entirely', async () => {
        const fixture = await writeEvidence('cleanup-missing-evidence', evidence => {
            delete evidence.validation.gates.cleanup;
            delete evidence.metrics.gates.cleanup;
        });
        const result = await grade(fixture);
        assert.equal(result.passed, false, 'absent cleanup evidence must not be read as cleanup success');
        assert.equal(findDetail(result, 'cleanup').passed, false);
    });
});

async function grade(
    fixture: EvidenceFixture,
    gates = requiredGates,
    metadataOverride: Record<string, unknown> = {},
): Promise<GraderResult> {
    return await new CorAuthoritativeGrader().grade({
        trajectory: trajectory(fixture, gates, metadataOverride),
        config: {
            validationPath: 'cor-validation.json',
            metricsPath: 'custom_metrics.json',
            requiredGates: gates,
        },
    }) as GraderResult;
}

function trajectory(
    fixture: EvidenceFixture,
    gates: string[],
    metadataOverride: Record<string, unknown> = {},
): Trajectory {
    return {
        id: `trajectory-${path.basename(fixture.root)}`,
        stimulus: {
            name: 'api-ts-functions-minimal',
            prompt: 'Build the fixture.',
            tags: {
                scenarioId: 'api-ts-functions-minimal',
                model: 'gpt-5.6-sol',
                arm: 'rails',
                endpoint: 'local',
            },
            environment: {
                env: {
                    COR_EVAL_SCENARIO_ID: 'api-ts-functions-minimal',
                    COR_EVAL_MODEL: 'gpt-5.6-sol',
                    COR_EVAL_ARM: 'rails',
                    COR_EVAL_ENDPOINT: 'local',
                },
            },
            graders: [{
                type: 'cor-authoritative',
                config: { requiredGates: gates },
            }],
        },
        events: [],
        metrics: computeMetrics([]),
        output: '',
        workDir: fixture.workDir ?? fixture.artifactDir,
        artifactDir: fixture.artifactDir,
        artifactDirStrict: true,
        metadata: {
            model: 'gpt-5.6-sol',
            skillsLoaded: [],
            startedAt: new Date(0),
            completedAt: new Date(1),
            executor: 'cor-aca',
            sessionID: 'run-1',
            evaluationArm: 'rails',
            scenarioId: 'api-ts-functions-minimal',
            endpoint: 'local',
            runId: 'run-1',
            requestedModel: 'gpt-5.6-sol',
            observedModels: ['gpt-5.6-sol'],
            candidateCommit: 'commit-1',
            agentAssetsHash: 'assets-1',
            evaluationDefinitionHash: 'definition-1',
            scenarioHash: 'scenario-1',
            promptSource: 'evals/scenarios/api-ts-functions-minimal.json#prompt',
            ...metadataOverride,
        } as Trajectory['metadata'] & {
            evaluationArm: string;
            scenarioId: string;
            endpoint: string;
        },
    };
}

async function writeEvidence(
    name: string,
    mutate?: (evidence: EvidencePair) => void,
): Promise<EvidenceFixture> {
    const root = path.join(scratchRoot, name);
    const artifactDir = path.join(root, 'artifacts');
    await fs.mkdir(artifactDir, { recursive: true });
    const evidence = makeEvidence();
    mutate?.(evidence);
    await Promise.all([
        fs.writeFile(
            path.join(artifactDir, 'cor-validation.json'),
            `${JSON.stringify(evidence.validation)}\n`,
        ),
        fs.writeFile(
            path.join(artifactDir, 'custom_metrics.json'),
            `${JSON.stringify(evidence.metrics)}\n`,
        ),
    ]);
    return { root, artifactDir };
}

function makeEvidence(): EvidencePair {
    const identity = {
        scenarioId: 'api-ts-functions-minimal',
        model: 'gpt-5.6-sol',
        arm: 'rails',
        endpoint: 'local',
        runId: 'run-1',
    };
    const provenance = {
        scenarioId: identity.scenarioId,
        candidateCommit: 'commit-1',
        agentAssetsHash: 'assets-1',
        evaluationDefinitionHash: 'definition-1',
        scenarioHash: 'scenario-1',
        promptSource: 'evals/scenarios/api-ts-functions-minimal.json#prompt',
        model: identity.model,
        arm: identity.arm,
        endpoint: identity.endpoint,
        runId: identity.runId,
    };
    const applicability = Object.fromEntries(allGates.map(gate => [
        gate,
        requiredGates.includes(gate),
    ]));
    const gates = Object.fromEntries(allGates.map(gate => [
        gate,
        requiredGates.includes(gate)
            ? { status: 'passed', evidence: [`reports/${gate}.json`] }
            : { status: 'not-applicable', reason: 'Scenario contract does not require this gate.' },
    ]));
    const values: Record<string, boolean | null | string> = {
        authoritative_hard_gates_passed: true,
    };
    for (const gate of allGates) {
        const prefix = gate.replaceAll('-', '_');
        const applicable = requiredGates.includes(gate);
        values[`${prefix}_applicable`] = applicable;
        values[`${prefix}_status`] = applicable ? 'passed' : 'not-applicable';
        values[`${prefix}_success`] = applicable ? true : null;
    }
    return {
        validation: {
            schema: AUTHORITATIVE_SCHEMA,
            schemaVersion: 1,
            identity: structuredClone(identity),
            provenance: structuredClone(provenance),
            applicability: structuredClone(applicability),
            gates: structuredClone(gates),
        },
        metrics: {
            schema: CUSTOM_METRICS_SCHEMA,
            schemaVersion: 1,
            identity: structuredClone(identity),
            provenance: structuredClone(provenance),
            applicability: structuredClone(applicability),
            gates: structuredClone(gates),
            values,
        },
    };
}

function findDetail(result: GraderResult, name: string): GraderResult {
    for (const group of result.details ?? []) {
        const found = group.details?.find(detail => detail.name === name);
        if (found) {
            return found;
        }
    }
    throw new Error(`Missing detail: ${name}`);
}

interface EvidenceFixture {
    root: string;
    artifactDir: string;
    workDir?: string;
}

interface EvidencePair {
    validation: ArtifactDocumentBase;
    metrics: ArtifactDocumentBase & {
        values: Record<string, boolean | null | string>;
    };
}

interface ArtifactDocumentBase {
    schema: string;
    schemaVersion: number;
    identity: Record<string, string>;
    provenance: ArtifactProvenance;
    applicability: Record<string, boolean>;
    diagnosticSummary?: string;
    gates: Record<string, {
        status: string;
        evidence?: string[];
        reason?: string;
    }>;
}

interface ArtifactProvenance extends Record<string, unknown> {
    scenarioId: string;
    candidateCommit: string;
    agentAssetsHash: string;
    evaluationDefinitionHash?: string;
    scenarioHash: string;
    promptSource: string;
    model: string;
    arm: string;
    endpoint: string;
    runId: string;
}
