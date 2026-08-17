/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-floating-promises -- node:test registrations are intentionally top-level. */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
    discoverVallyExperimentEvidence,
    renderVallyRunDiagnostics,
} from '../src/vallyExperimentReport';

const scratchRoot = path.resolve(`evals/results/vally-experiment-report-test-${process.pid}`);

describe('Vally native experiment report discovery', () => {
    before(async () => {
        await fs.rm(scratchRoot, { recursive: true, force: true });
        await fs.mkdir(scratchRoot, { recursive: true });
    });

    after(async () => {
        await fs.rm(scratchRoot, { recursive: true, force: true });
    });

    test('discovers strict paired bundles and records cleanup verification', async () => {
        await Promise.all([
            writeBundle('rails', 'rails-run', true),
            writeBundle('baseline-controlled', 'baseline-run', true),
        ]);
        const manifest = await discoverVallyExperimentEvidence([scratchRoot], true);
        assert.equal(manifest.artifactBundles.length, 2);
        assert.equal(manifest.treatmentInputs.length, 1);
        assert.equal(manifest.baselineInputs.length, 1);
        assert.equal(manifest.cleanupVerification.verifiedBundles, 2);
        assert.equal(manifest.cleanupVerification.missingBundles, 0);
        const rails = manifest.artifactBundles.find(bundle => bundle.arm === 'rails');
        assert.equal(rails?.diagnostics.failureCode, 'buildFailed');
        assert.equal(rails?.diagnostics.gates.build, 'failed');
        assert.deepEqual(rails?.diagnostics.failedGates, [{
            gate: 'build',
            evidence: ['npm run build exited 1'],
            reason: 'Generated project did not build.',
        }]);
        const markdown = renderVallyRunDiagnostics(manifest, scratchRoot);
        assert.match(markdown, /## Rails run diagnostics/);
        assert.match(markdown, /\| Tests \| Runtime \| Debugger \|/);
        assert.match(markdown, /buildFailed/);
        assert.match(markdown, /Gate `build`: Generated project did not build\./);
        assert.match(markdown, /\[run result\]\(rails\/api-ts-functions-minimal\/artifacts\/run-result\.json\)/);
        assert.match(markdown, /All controlled baseline runs passed\./);
    });

    test('fails release enforcement for missing post-sweep cleanup proof', async () => {
        const root = path.join(scratchRoot, 'missing-cleanup');
        await writeBundle('rails', 'unverified-run', false, root);
        await assert.rejects(
            discoverVallyExperimentEvidence([root], true),
            /requires post-sweep cleanup verification/,
        );
    });

    test('rejects identity mismatches across authoritative artifacts', async () => {
        const root = path.join(scratchRoot, 'mismatch');
        const artifactDirectory = await writeBundle('rails', 'mismatch-run', true, root);
        const validationPath = path.join(artifactDirectory, 'cor-validation.json');
        const validation = JSON.parse(await fs.readFile(validationPath, 'utf8')) as {
            identity: { model: string };
        };
        validation.identity.model = 'wrong-model';
        await fs.writeFile(validationPath, `${JSON.stringify(validation)}\n`);
        await assert.rejects(
            discoverVallyExperimentEvidence([root]),
            /validation identity\.model must be "test-model"/,
        );
    });
});

async function writeBundle(
    arm: 'rails' | 'baseline-controlled',
    runId: string,
    cleanupVerified: boolean,
    root = scratchRoot,
): Promise<string> {
    const scenarioId = 'api-ts-functions-minimal';
    const model = 'test-model';
    const endpoint = 'local';
    const artifactDirectory = path.join(root, arm, scenarioId, 'artifacts');
    await fs.mkdir(artifactDirectory, { recursive: true });
    const passed = arm === 'baseline-controlled';
    const result = {
        schemaVersion: '1',
        runId,
        scenarioId,
        attempt: 1,
        evaluationArm: arm,
        outcome: passed ? 'autonomous_success' : 'failed',
        failedStage: passed ? undefined : 'build',
        failureCode: passed ? undefined : 'buildFailed',
        failureCategory: passed ? undefined : 'product_failure',
        error: passed ? undefined : 'Generated project did not build.',
        candidateCommit: 'commit',
        agentAssetsHash: arm === 'rails' ? 'assets' : 'not-applicable:baseline-controlled',
        model,
        requestedModel: model,
        observedModels: [model],
        durationMs: 1,
        agentRetries: 0,
        stages: [],
    };
    const identity = { scenarioId, model, arm, endpoint, runId };
    await Promise.all([
        write('native-summary.json', {
            schemaVersion: '1',
            evaluationArm: arm,
            candidateCommit: result.candidateCommit,
            agentAssetsHash: result.agentAssetsHash,
            through: endpoint,
            requestedModel: model,
            observedModels: [model],
            results: [result],
        }),
        write('run-result.json', result),
        write('validation-manifest.json', {
            schemaVersion: '1',
            executor: 'cor-aca',
            ownerLabel: `cor-${runId}`,
            selection: { scenarioId, arm, endpoint, model },
            native: { runId },
            validation: { cleanupVerified },
        }),
        write('cor-validation.json', {
            schema: 'copilot-on-rails-authoritative-validation/v1',
            schemaVersion: 1,
            identity,
            gates: {
                build: {
                    status: passed ? 'passed' : 'failed',
                    reason: passed ? undefined : 'Generated project did not build.',
                    evidence: passed ? ['npm run build exited 0'] : ['npm run build exited 1'],
                },
            },
        }),
        write('custom_metrics.json', {
            schema: 'copilot-on-rails-authoritative-metrics/v1',
            schemaVersion: 1,
            identity,
        }),
    ]);
    return artifactDirectory;

    async function write(name: string, value: unknown): Promise<void> {
        await fs.writeFile(path.join(artifactDirectory, name), `${JSON.stringify(value)}\n`);
    }
}
