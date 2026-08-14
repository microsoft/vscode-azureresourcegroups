/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyFailure } from '../src/report';
import { isSandboxInfrastructureFailureCode } from '../src/SandboxProjectValidator';
import { isContainerRegistryFailure, isLocalRuntimeInfrastructureFailureCode } from '../src/SandboxLocalRuntimeValidator';

void test('an agent session stall is infrastructure, not a product failure', () => {
    // Observed: scaffold died with "Timeout after 600000ms waiting for session.idle" and was
    // counted as a product failure, which understates the product's real success rate.
    assert.ok(isSandboxInfrastructureFailureCode('agentRunTimedOut'));
    assert.equal(
        classifyFailure({
            runId: 'r', scenarioId: 's', attempt: 0, outcome: 'failed',
            failedStage: 'scaffold', failureCode: 'agentRunTimedOut', durationMs: 1,
        }),
        'infrastructure_failure',
    );
});

void test('a genuine agent failure is still a product failure', () => {
    assert.equal(
        classifyFailure({
            runId: 'r', scenarioId: 's', attempt: 0, outcome: 'failed',
            failedStage: 'scaffold', failureCode: 'agentRunFailed', durationMs: 1,
        }),
        'product_failure',
    );
});

void test('a successful attempt has no failure category', () => {
    assert.equal(
        classifyFailure({
            runId: 'r', scenarioId: 's', attempt: 0, outcome: 'autonomous_success', durationMs: 1,
        }),
        undefined,
    );
});

void test('a container registry denial is infrastructure, not a product failure', () => {
    // Observed: `docker compose up` failed with "error pulling image configuration: ... denied".
    // The generated compose file was correct; the sandbox could not reach the registry.
    assert.ok(isContainerRegistryFailure('error pulling image configuration: download failed after attempts=1: denied:'));
    assert.ok(isLocalRuntimeInfrastructureFailureCode('localContainerRegistryUnavailable'));
    assert.equal(
        classifyFailure({
            runId: 'r', scenarioId: 's', attempt: 0, outcome: 'failed',
            failedStage: 'local-runtime', failureCode: 'localContainerRegistryUnavailable', durationMs: 1,
        }),
        'infrastructure_failure',
    );
});

void test('registry rate limiting is recognised', () => {
    assert.ok(isContainerRegistryFailure('toomanyrequests: You have reached your pull rate limit.'));
    assert.ok(isContainerRegistryFailure('failed to resolve reference "docker.io/library/postgres:17"'));
});

void test('an application error is not mistaken for a registry failure', () => {
    // The guard must stay narrow, or real product defects get excused as infrastructure.
    assert.ok(!isContainerRegistryFailure('Error: connect ECONNREFUSED 127.0.0.1:5432'));
    assert.ok(!isContainerRegistryFailure('psql: FATAL: database "localdev" does not exist'));
    assert.equal(
        classifyFailure({
            runId: 'r', scenarioId: 's', attempt: 0, outcome: 'failed',
            failedStage: 'local-runtime', failureCode: 'localTaskFailed', durationMs: 1,
        }),
        'product_failure',
    );
});

void test('an upstream turn that starts and never streams is infrastructure, not a product failure', () => {
    // Observed 2026-08-14: three consecutive runs emitted `assistant.turn_start` and then no
    // events at all until the 300s idle timeout, while the same scenario and model passed in
    // 22s once the upstream incident cleared. Blaming the product for that would be wrong.
    assert.ok(isSandboxInfrastructureFailureCode('agentRunStalled'));
    assert.equal(
        classifyFailure({
            runId: 'r', scenarioId: 's', attempt: 0, outcome: 'failed',
            failedStage: 'requirements', failureCode: 'agentRunStalled', durationMs: 1,
        }),
        'infrastructure_failure',
    );
});
