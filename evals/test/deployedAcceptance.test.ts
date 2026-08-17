/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { test } from 'node:test';
import {
    evaluateDeployedAcceptance,
    isAzureInfrastructureFailure,
    parseDeployedEndpoints,
} from '../src/deployedAcceptance';

const azdShowWithEndpoint = JSON.stringify({
    name: 'cor-eval-app',
    services: {
        app: { project: '.', endpoints: ['https://app.happy-rock.eastus2.azurecontainerapps.io'] },
    },
});

const noSleep = async (): Promise<void> => { /* keep retry tests instant */ };

void test('a deployed endpoint that serves traffic passes', async () => {
    const result = await evaluateDeployedAcceptance({
        azdShowOutput: azdShowWithEndpoint,
        probe: async () => ({ status: 200 }),
        sleep: noSleep,
    });

    assert.strictEqual(result.outcome, 'passed');
    assert.strictEqual(result.endpoints.length, 1);
    assert.strictEqual(result.probes[0].attempts, 1);
    assert.strictEqual(result.probes[0].healthy, true);
});

void test('a provisioned but unreachable endpoint fails, so resources alone never prove success', async () => {
    const result = await evaluateDeployedAcceptance({
        azdShowOutput: azdShowWithEndpoint,
        probe: async () => { throw new Error('ECONNREFUSED'); },
        maxAttempts: 3,
        sleep: noSleep,
    });

    assert.strictEqual(result.outcome, 'failed');
    assert.strictEqual(result.failureCode, 'endpointUnreachable');
    assert.strictEqual(result.probes[0].attempts, 3);
    assert.match(result.error ?? '', /ECONNREFUSED/);
});

void test('a cold-starting endpoint is retried rather than failed', async () => {
    let call = 0;
    const result = await evaluateDeployedAcceptance({
        azdShowOutput: azdShowWithEndpoint,
        probe: async () => {
            call++;
            return { status: call < 3 ? 503 : 200 };
        },
        maxAttempts: 5,
        sleep: noSleep,
    });

    assert.strictEqual(result.outcome, 'passed');
    assert.strictEqual(result.probes[0].attempts, 3, 'the probe must survive container-app cold start');
});

void test('a 4xx is a settled answer and is not retried', async () => {
    let calls = 0;
    const result = await evaluateDeployedAcceptance({
        azdShowOutput: azdShowWithEndpoint,
        probe: async () => { calls++; return { status: 404 }; },
        maxAttempts: 5,
        sleep: noSleep,
    });

    assert.strictEqual(result.outcome, 'failed');
    assert.strictEqual(result.failureCode, 'endpointUnhealthy');
    assert.strictEqual(calls, 1, 'retrying a deterministic 404 only wastes wall-clock time');
});

void test('a deployment that exposes no endpoint cannot be reported as a user success', async () => {
    const result = await evaluateDeployedAcceptance({
        azdShowOutput: JSON.stringify({ name: 'worker-only', services: { worker: { project: '.' } } }),
        probe: async () => ({ status: 200 }),
        sleep: noSleep,
    });

    assert.strictEqual(result.outcome, 'failed');
    assert.strictEqual(result.failureCode, 'noDeployedEndpoint');
    assert.deepStrictEqual(result.probes, []);
});

void test('unparseable azd output yields no endpoints instead of throwing', () => {
    assert.deepStrictEqual(parseDeployedEndpoints('not json'), []);
    assert.deepStrictEqual(parseDeployedEndpoints('null'), []);
    assert.deepStrictEqual(parseDeployedEndpoints(JSON.stringify({ services: null })), []);
});

void test('multiple services each contribute their own probe', async () => {
    const output = JSON.stringify({
        services: {
            api: { endpoints: ['https://api.example.azurecontainerapps.io'] },
            web: { endpoints: ['https://web.example.azurecontainerapps.io'] },
        },
    });
    const result = await evaluateDeployedAcceptance({
        azdShowOutput: output,
        probe: async () => ({ status: 200 }),
        sleep: noSleep,
    });

    assert.strictEqual(result.endpoints.length, 2);
    assert.strictEqual(result.probes.length, 2);
    assert.strictEqual(result.outcome, 'passed');
});

void test('Azure capacity failures are recognised as infrastructure', () => {
    assert.ok(isAzureInfrastructureFailure('ERROR: QuotaExceeded: not enough cores'));
    assert.ok(isAzureInfrastructureFailure('Code: SkuNotAvailable'));
    assert.ok(isAzureInfrastructureFailure('ZonalAllocationFailed'));
    assert.strictEqual(
        isAzureInfrastructureFailure("ERROR: deployment failed: invalid template parameter 'appName'"),
        false,
        'a malformed template is a generated-artifact defect',
    );
});

void test('the real eastus2 capacity outage observed during bring-up is infrastructure', () => {
    // Verbatim from a live azd up against subscription 570117a0 on 2026-08-13.
    const observed = [
        'ManagedEnvironmentCapacityHeavyUsageError: AKS is experiencing heavy usage in region eastus2.',
        'ErrorCode: AKSCapacityHeavyUsage',
    ].join('\n');

    assert.ok(
        isAzureInfrastructureFailure(observed),
        'an Azure region running out of capacity must never be recorded as a Copilot on Rails defect',
    );
});

void test('a bad template is still a product defect even when azd reports it the same way', () => {
    const output = [
        'ERROR: deployment failed: step "provision" failed: deploying layer provision:',
        "InvalidTemplate: Unable to evaluate template language function 'reference'.",
    ].join('\n');

    assert.strictEqual(isAzureInfrastructureFailure(output), false);
});
