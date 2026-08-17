/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import * as os from 'os';
import * as path from 'path';
import { mkdtempSync, promises as fs } from 'fs';

import {
    DeploymentSkillFetcher,
    DeploymentSkillUnavailableError,
    azurePrepareRepository,
    ensureDeploymentSkill,
} from '../src/deploymentSkill';
import { classifyFailure } from '../src/report';

function createWorkspace(): string {
    return mkdtempSync(path.join(os.tmpdir(), 'deployment-skill-test-'));
}

function createFetcher(commit: string, overrides: Partial<DeploymentSkillFetcher> = {}): DeploymentSkillFetcher {
    return {
        resolveCommit: async () => commit,
        download: async (_repository, _commit, destination) => {
            await fs.mkdir(destination, { recursive: true });
            await fs.writeFile(path.join(destination, 'SKILL.md'), '# azure-prepare\n');
        },
        ...overrides,
    };
}

void test('the azure-prepare skill lands where the deploy agent reads it', async () => {
    // azure-deploy.agent.md reads `.agents/skills/azure-prepare/SKILL.md` verbatim, so the
    // destination path is part of the contract rather than an implementation detail.
    const workspace = createWorkspace();
    const provenance = await ensureDeploymentSkill(workspace, {
        cacheRoot: createWorkspace(),
        fetcher: createFetcher('a'.repeat(40)),
    });
    assert.equal(provenance.repository, azurePrepareRepository);
    assert.equal(provenance.skillPath, path.join('.agents', 'skills', 'azure-prepare'));
    const skill = await fs.readFile(path.join(workspace, provenance.skillPath, 'SKILL.md'), 'utf8');
    assert.match(skill, /azure-prepare/u);
});

void test('the graded revision is pinned to a resolved commit', async () => {
    // Grading against a moving branch would make two runs incomparable.
    const commit = 'b'.repeat(40);
    const provenance = await ensureDeploymentSkill(createWorkspace(), {
        cacheRoot: createWorkspace(),
        ref: 'main',
        fetcher: createFetcher(commit),
    });
    assert.equal(provenance.commit, commit);
    assert.equal(provenance.ref, 'main');
});

void test('a second run reuses the cached commit instead of downloading again', async () => {
    const cacheRoot = createWorkspace();
    const commit = 'c'.repeat(40);
    let downloads = 0;
    const fetcher = createFetcher(commit, {
        download: async (_repository, _commit, destination) => {
            downloads += 1;
            await fs.mkdir(destination, { recursive: true });
            await fs.writeFile(path.join(destination, 'SKILL.md'), '# azure-prepare\n');
        },
    });
    await ensureDeploymentSkill(createWorkspace(), { cacheRoot, fetcher });
    await ensureDeploymentSkill(createWorkspace(), { cacheRoot, fetcher });
    assert.equal(downloads, 1);
});

void test('an unresolvable ref fails loudly rather than running the agent without its manual', async () => {
    // Silently continuing would grade a deploy agent that has lost its operating manual, which
    // measures the evaluation host rather than the product.
    await assert.rejects(
        ensureDeploymentSkill(createWorkspace(), {
            cacheRoot: createWorkspace(),
            fetcher: createFetcher('d'.repeat(40), {
                resolveCommit: async () => {
                    throw new Error('gh: not found');
                },
            }),
        }),
        DeploymentSkillUnavailableError,
    );
});

void test('a download that omits SKILL.md is rejected', async () => {
    await assert.rejects(
        ensureDeploymentSkill(createWorkspace(), {
            cacheRoot: createWorkspace(),
            fetcher: createFetcher('e'.repeat(40), {
                download: async (_repository, _commit, destination) => {
                    await fs.mkdir(destination, { recursive: true });
                },
            }),
        }),
        DeploymentSkillUnavailableError,
    );
});

void test('a missing azure-prepare skill is infrastructure, not a product defect', () => {
    assert.equal(
        classifyFailure({
            runId: 'r', scenarioId: 's', attempt: 0, outcome: 'failed',
            failedStage: 'deploy-generate', failureCode: 'deploymentSkillUnavailable', durationMs: 1,
        }),
        'infrastructure_failure',
    );
});

void test('an infrastructure deploy failure is excluded, never counted as a pass', async () => {
    // Regression: runDeploymentStages used to swallow infrastructure failures, letting a run that
    // never produced a deploy verdict report autonomous_success. Absent evidence and passing
    // evidence are different release signals, so this must classify as infrastructure and be
    // excluded from product-quality rates rather than inflate them.
    const category = classifyFailure({
        runId: 'deploy-infra-regression',
        scenarioId: 'api-ts-functions-minimal',
        attempt: 1,
        outcome: 'failed',
        failedStage: 'deploy-readiness',
        failureCode: 'containerRuntimeUnavailable',
    } as Parameters<typeof classifyFailure>[0]);
    assert.equal(category, 'infrastructure_failure');
});
