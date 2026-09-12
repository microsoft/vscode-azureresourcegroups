/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'mocha';
import { computeDeploymentInventory, DeploymentTarget, InventoryResource, parseResourceGroupFromId } from '../../src/utils/copilotOnRails/deploymentInventory';

const SUB = '00000000-0000-0000-0000-000000000000';

function resourceId(rg: string, provider: string, name: string): string {
    return `/subscriptions/${SUB}/resourceGroups/${rg}/providers/${provider}/${name}`;
}

function resource(rg: string, provider: string, name: string): InventoryResource {
    return { id: resourceId(rg, provider, name), name, type: provider };
}

function target(id: string, provisioningState: string): DeploymentTarget {
    return { id, provisioningState };
}

suite('deploymentInventory', () => {
    suite('parseResourceGroupFromId', () => {
        test('extracts the resource group name', () => {
            assert.strictEqual(parseResourceGroupFromId(resourceId('rg-app', 'Microsoft.Web/sites', 'app1')), 'rg-app');
        });

        test('is case-insensitive on the segment name', () => {
            assert.strictEqual(parseResourceGroupFromId(`/subscriptions/${SUB}/RESOURCEGROUPS/rg-x/providers/p/n`), 'rg-x');
        });

        test('returns undefined for a subscription-scoped id', () => {
            assert.strictEqual(parseResourceGroupFromId(`/subscriptions/${SUB}/providers/Microsoft.Foo/bar`), undefined);
        });
    });

    suite('computeDeploymentInventory', () => {
        test('fresh resource group: empty baseline, all deployment targets succeeded => expected only', () => {
            const app = resource('rg-app', 'Microsoft.Web/sites', 'app1');
            const plan = resource('rg-app', 'Microsoft.Web/serverfarms', 'plan1');

            const result = computeDeploymentInventory(
                [],
                [app, plan],
                [target(app.id, 'Succeeded'), target(plan.id, 'Succeeded')],
                'rg-app',
            );

            assert.strictEqual(result.createdResources.length, 2);
            assert.ok(result.createdResources.every((r) => r.classification === 'expected'));
            assert.strictEqual(result.orphanedResourceGroups.length, 0);
            assert.strictEqual(result.hasCleanupConcerns, false);
        });

        test('pre-existing resources in the baseline are excluded from the diff', () => {
            const existing = resource('rg-app', 'Microsoft.Storage/storageAccounts', 'preexisting');
            const app = resource('rg-app', 'Microsoft.Web/sites', 'app1');

            const result = computeDeploymentInventory(
                [existing.id],
                [existing, app],
                [target(app.id, 'Succeeded')],
                'rg-app',
            );

            assert.strictEqual(result.createdResources.length, 1);
            assert.strictEqual(result.createdResources[0].id, app.id);
        });

        test('baseline matching is case-insensitive', () => {
            const app = resource('rg-app', 'Microsoft.Web/sites', 'app1');
            const result = computeDeploymentInventory(
                [app.id.toUpperCase()],
                [app],
                [target(app.id, 'Succeeded')],
                'rg-app',
            );
            assert.strictEqual(result.createdResources.length, 0);
        });

        test('no-op redeploy: identical baseline and post => empty diff', () => {
            const app = resource('rg-app', 'Microsoft.Web/sites', 'app1');
            const plan = resource('rg-app', 'Microsoft.Web/serverfarms', 'plan1');
            const result = computeDeploymentInventory(
                [app.id, plan.id],
                [app, plan],
                [target(app.id, 'Succeeded'), target(plan.id, 'Succeeded')],
                'rg-app',
            );
            assert.strictEqual(result.createdResources.length, 0);
            assert.strictEqual(result.hasCleanupConcerns, false);
        });

        test('created resource not reported by any deployment => orphaned', () => {
            const app = resource('rg-app', 'Microsoft.Web/sites', 'app1');
            const strayFromImperativeCli = resource('rg-app', 'Microsoft.Cache/redis', 'stray');

            const result = computeDeploymentInventory(
                [],
                [app, strayFromImperativeCli],
                [target(app.id, 'Succeeded')],
                'rg-app',
            );

            const stray = result.createdResources.find((r) => r.id === strayFromImperativeCli.id);
            assert.ok(stray);
            assert.strictEqual(stray?.classification, 'orphaned');
            assert.strictEqual(result.hasCleanupConcerns, true);
        });

        test('deployment target with a non-succeeded state => failed', () => {
            const app = resource('rg-app', 'Microsoft.Web/sites', 'app1');
            const result = computeDeploymentInventory(
                [],
                [app],
                [target(app.id, 'Failed')],
                'rg-app',
            );
            assert.strictEqual(result.createdResources[0].classification, 'failed');
            assert.strictEqual(result.hasCleanupConcerns, true);
        });

        test('resource created outside the expected resource group (healing retry) => orphaned + orphaned RG', () => {
            const finalApp = resource('rg-app-2', 'Microsoft.Web/sites', 'app1');
            const abandoned = resource('rg-app', 'Microsoft.Web/sites', 'app1');
            const abandonedPlan = resource('rg-app', 'Microsoft.Web/serverfarms', 'plan1');

            const result = computeDeploymentInventory(
                [],
                [finalApp, abandoned, abandonedPlan],
                [target(finalApp.id, 'Succeeded')],
                'rg-app-2',
            );

            assert.strictEqual(result.createdResources.find((r) => r.id === finalApp.id)?.classification, 'expected');
            assert.strictEqual(result.createdResources.find((r) => r.id === abandoned.id)?.classification, 'orphaned');
            assert.deepStrictEqual(result.orphanedResourceGroups, [{ name: 'rg-app', resourceCount: 2 }]);
            assert.strictEqual(result.hasCleanupConcerns, true);
        });

        test('duplicate post entries are counted once', () => {
            const app = resource('rg-app', 'Microsoft.Web/sites', 'app1');
            const result = computeDeploymentInventory(
                [],
                [app, { ...app }],
                [target(app.id, 'Succeeded')],
                'rg-app',
            );
            assert.strictEqual(result.createdResources.length, 1);
        });

        test('without an expected resource group, unknown-to-deployment resources are still orphaned', () => {
            const app = resource('rg-app', 'Microsoft.Web/sites', 'app1');
            const stray = resource('rg-other', 'Microsoft.Web/sites', 'app2');
            const result = computeDeploymentInventory(
                [],
                [app, stray],
                [target(app.id, 'Succeeded')],
                undefined,
            );
            assert.strictEqual(result.createdResources.find((r) => r.id === app.id)?.classification, 'expected');
            assert.strictEqual(result.createdResources.find((r) => r.id === stray.id)?.classification, 'orphaned');
        });

        test('targetsUnavailable makes every created resource unverified and suppresses cleanup', () => {
            const app = resource('rg-app', 'Microsoft.Web/sites', 'app1');
            const stray = resource('rg-other', 'Microsoft.Web/sites', 'app2');
            const result = computeDeploymentInventory(
                [],
                [app, stray],
                [],
                'rg-app',
                { targetsUnavailable: true },
            );

            assert.deepStrictEqual(result.createdResources.map((r) => r.classification), ['unverified', 'unverified']);
            assert.deepStrictEqual(result.orphanedResourceGroups, []);
            assert.strictEqual(result.hasCleanupConcerns, false);
            assert.strictEqual(result.targetsUnavailable, true);
        });
    });
});
