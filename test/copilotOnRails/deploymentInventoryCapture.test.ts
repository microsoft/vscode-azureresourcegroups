/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeploymentOperation, GenericResource } from '@azure/arm-resources';
import { IActionContext } from '@microsoft/vscode-azext-utils';
import type { AzureSubscription } from 'api/src/resources/azure';
import assert from 'assert';
import { AzureResourcesService } from '../../src/services/AzureResourcesService';
import { captureInventory } from '../../src/utils/copilotOnRails/deploymentInventoryCapture';

const SUB = 's';
const context = {} as unknown as IActionContext;
const subscription = { subscriptionId: SUB } as unknown as AzureSubscription;

function resourceId(resourceGroup: string, provider: string, type: string, name: string): string {
    return `/subscriptions/${SUB}/resourceGroups/${resourceGroup}/providers/${provider}/${type}/${name}`;
}

function resource(id: string, name: string, type: string): GenericResource {
    return { id, name, type } as GenericResource;
}

function deploymentTarget(id: string, provisioningState: string): DeploymentOperation {
    return { properties: { targetResource: { id }, provisioningState } } as DeploymentOperation;
}

/** A minimal in-memory service so the capture reads deterministic data without the extension host. */
function mockService(resources: GenericResource[], operations: DeploymentOperation[]): AzureResourcesService {
    return {
        listResources: async () => resources,
        listResourceGroups: async () => [],
        listDeploymentOperations: async () => operations,
    };
}

suite('captureInventory', () => {
    const preExisting = resourceId('rg-target', 'Microsoft.Web', 'serverfarms', 'plan1');
    const targetApp = resourceId('rg-target', 'Microsoft.Web', 'sites', 'app1');
    const strayInOtherRg = resourceId('rg-stray', 'Microsoft.ManagedIdentity', 'userAssignedIdentities', 'mi1');

    test('with a baseline, reports only newly created resources and classifies them', async () => {
        const service = mockService(
            [resource(preExisting, 'plan1', 'Microsoft.Web/serverfarms'),
            resource(targetApp, 'app1', 'Microsoft.Web/sites'),
            resource(strayInOtherRg, 'mi1', 'Microsoft.ManagedIdentity/userAssignedIdentities')],
            [deploymentTarget(targetApp, 'Succeeded')],
        );

        const result = await captureInventory(context, subscription, {
            expectedResourceGroup: 'rg-target',
            deploymentNames: ['dep1'],
            resourceGroups: ['rg-target'],
            baseline: [preExisting],
        }, service);

        // The pre-existing resource is in the baseline, so only the two new ones are reported.
        assert.deepStrictEqual(
            result.createdResources.map((r) => ({ id: r.id, classification: r.classification })).sort((a, b) => a.id.localeCompare(b.id)),
            [
                { id: strayInOtherRg, classification: 'orphaned' },
                { id: targetApp, classification: 'expected' },
            ],
        );
        assert.deepStrictEqual(result.orphanedResourceGroups, [{ name: 'rg-stray', resourceCount: 1 }]);
        assert.strictEqual(result.hasCleanupConcerns, true);
    });

    test('without a baseline, falls back to deployment targets only and never over-reports', async () => {
        const strayImperative = resourceId('rg-target', 'Microsoft.Storage', 'storageAccounts', 'stray1');
        const service = mockService(
            [resource(preExisting, 'plan1', 'Microsoft.Web/serverfarms'),
            resource(targetApp, 'app1', 'Microsoft.Web/sites'),
            resource(strayImperative, 'stray1', 'Microsoft.Storage/storageAccounts')],
            [deploymentTarget(targetApp, 'Succeeded')],
        );

        const result = await captureInventory(context, subscription, {
            expectedResourceGroup: 'rg-target',
            deploymentNames: ['dep1'],
            resourceGroups: ['rg-target'],
            // No baseline provided.
        }, service);

        // Pre-existing and imperative-stray resources are NOT flagged; only the tracked target is.
        assert.deepStrictEqual(
            result.createdResources.map((r) => ({ id: r.id, classification: r.classification })),
            [{ id: targetApp, classification: 'expected' }],
        );
        assert.deepStrictEqual(result.orphanedResourceGroups, []);
        assert.strictEqual(result.hasCleanupConcerns, false);
    });

    test('classifies a deployment target with a non-succeeded state as failed', async () => {
        const service = mockService(
            [resource(targetApp, 'app1', 'Microsoft.Web/sites')],
            [deploymentTarget(targetApp, 'Failed')],
        );

        const result = await captureInventory(context, subscription, {
            expectedResourceGroup: 'rg-target',
            deploymentNames: ['dep1'],
            resourceGroups: ['rg-target'],
            baseline: [],
        }, service);

        assert.strictEqual(result.createdResources.length, 1);
        assert.strictEqual(result.createdResources[0].classification, 'failed');
        assert.strictEqual(result.hasCleanupConcerns, true);
    });
});
