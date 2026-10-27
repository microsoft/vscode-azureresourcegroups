/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as vscode from 'vscode';
import { AzExtResourceType, AzureResource, BranchDataProvider, ResourceModelBase } from '../../api/src';
import { AzureResourceTreeDataProvider } from '../../src/tree/azure/AzureResourceTreeDataProvider';
import { getAccountAndTenantPrefix } from '../../src/tree/azure/idPrefix';
import { getCachedTestApi } from '../utils/testApiAccess';
import { api } from './api';
import { MockAzureSubscriptionProvider } from './MockAzureSubscriptionProvider';
import { createMockAzureResourcesServiceFactory, createMockSubscriptionWithFunctions } from './mockServiceFactory';

interface RevealNode extends ResourceModelBase {
    id: string;
    parent?: RevealNode;
}

suite('Azure resource identity prefix traversal', () => {
    teardown(() => {
        getCachedTestApi().testing.setOverrideAzureServiceFactory(undefined);
        getCachedTestApi().testing.setOverrideAzureSubscriptionProvider(undefined);
    });

    for (const grouping of ['resourceGroup', 'resourceType']) {
        test(`reveals nested ARM resources case-insensitively with ${grouping} grouping`, async () => {
            const mocks = createMockSubscriptionWithFunctions();
            const service = createMockAzureResourcesServiceFactory(mocks)();
            const resourceId = `${mocks.sub1.rg1.id}/providers/Microsoft.Sql/servers/Server/databases/Inventory`;
            const schemaId = `${resourceId}/schemas`;
            const childId = `${schemaId}/orders`;
            getCachedTestApi().testing.setOverrideAzureServiceFactory(() => ({
                ...service,
                listResources: async (_context, subscription) => subscription.subscriptionId === mocks.sub1.subscriptionId ? [{
                    id: resourceId,
                    name: 'Server/Inventory',
                    type: 'Microsoft.Sql/servers/databases',
                    location: 'westus2'
                }] : []
            }));
            const provider: BranchDataProvider<AzureResource, RevealNode> = {
                getResourceItem: resource => ({ id: resource.id }),
                getTreeItem: node => new vscode.TreeItem(node.id,
                    node.id === resourceId || node.id === schemaId
                        ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None),
                getChildren: node => {
                    if (node.id === resourceId) {
                        return [{ id: schemaId, parent: node }];
                    }
                    if (node.id === schemaId) {
                        return [{ id: `${schemaId}/Orders`, parent: node }, { id: childId, parent: node }];
                    }
                    return [];
                },
                getParent: node => node.parent
            };
            const disposable = api().registerAzureResourceBranchDataProvider(AzExtResourceType.SqlDatabases, provider);
            try {
                await vscode.commands.executeCommand(`azureResourceGroups.groupBy.${grouping}`);
                const subscriptions = await new MockAzureSubscriptionProvider(mocks).getAvailableSubscriptions();
                const subscription = subscriptions.find(item => item.subscriptionId === mocks.sub1.subscriptionId);
                assert.ok(subscription);
                const prefix = getAccountAndTenantPrefix(subscription);
                const options = { revealOptions: { focus: false, select: false, expand: false } };

                assert.strictEqual((await api().revealAzureResourceWithResult(resourceId.toUpperCase(), options))?.id,
                    prefix + resourceId);
                const result = await api().revealAzureResourceWithResult(`${resourceId.toUpperCase()}/schemas/orders`, options);
                assert.strictEqual(result?.id, prefix + childId);
                assert.strictEqual(result?.resource?.id, childId);

                const tree = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
                assert.strictEqual((await tree.findItemById(resourceId.toUpperCase(),
                    { propagateErrors: true }))?.id, prefix + resourceId);
                await assert.rejects(api().revealAzureResourceWithResult(`${resourceId}/schemas/ORDERS`, options),
                    /could not be found/);
                await assert.rejects(api().revealAzureResourceWithResult(`${resourceId}/SCHEMAS/orders`, options),
                    /could not be found/);
            } finally {
                disposable.dispose();
            }
        });

        for (const scenario of ['resource group named tenants', 'nested resource under an account named tenants']) {
            test(`reveals a ${scenario} with ${grouping} grouping`, async () => {
                const nested = scenario === 'nested resource under an account named tenants';
                const mocks = createMockSubscriptionWithFunctions();
                const service = createMockAzureResourcesServiceFactory(mocks)();
                const resourceGroupId = `${mocks.sub1.id}/resourceGroups/${nested ? 'rg' : 'tenants'}`;
                const resourceName = nested ? 'tenants' : 'app';
                const resourceId = `${resourceGroupId}/providers/${nested ? 'Microsoft.DocumentDB/databaseAccounts' : 'Microsoft.Web/sites'}/${resourceName}`;
                const fullId = nested ? `${resourceId}/database/container` : resourceId;
                getCachedTestApi().testing.setOverrideAzureServiceFactory(() => ({
                    ...service,
                    listResources: async (_context, subscription) => subscription.subscriptionId === mocks.sub1.subscriptionId ? [{
                        id: resourceId,
                        name: resourceName,
                        type: nested ? 'Microsoft.DocumentDB/databaseAccounts' : 'Microsoft.Web/sites',
                        kind: nested ? 'GlobalDocumentDB' : 'functionapp',
                        location: 'westus2'
                    }] : [],
                    listResourceGroups: async (_context, subscription) => subscription.subscriptionId === mocks.sub1.subscriptionId ? [{
                        id: resourceGroupId,
                        name: nested ? 'rg' : 'tenants',
                        type: 'Microsoft.Resources/resourceGroups',
                        location: 'westus2'
                    }] : []
                }));

                const branch: BranchDataProvider<AzureResource, RevealNode> = {
                    getResourceItem: resource => ({ id: resource.id }),
                    getTreeItem: node => new vscode.TreeItem(node.id,
                        nested && node.id !== fullId ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None),
                    getChildren: node => {
                        if (nested && node.id === resourceId) {
                            return [{ id: `${resourceId}/database`, parent: node }];
                        }
                        if (nested && node.id === `${resourceId}/database`) {
                            return [{ id: fullId, parent: node }];
                        }
                        return [];
                    },
                    getParent: node => node.parent
                };
                const disposable = api().registerAzureResourceBranchDataProvider(
                    nested ? AzExtResourceType.AzureCosmosDb : AzExtResourceType.FunctionApp, branch);
                try {
                    await vscode.commands.executeCommand(`azureResourceGroups.groupBy.${grouping}`);
                    const subscriptions = await new MockAzureSubscriptionProvider(mocks).getAvailableSubscriptions();
                    const subscription = subscriptions.find(item => item.subscriptionId === mocks.sub1.subscriptionId);
                    assert.ok(subscription);
                    const expected = getAccountAndTenantPrefix(subscription) + fullId;

                    assert.strictEqual((await api().revealAzureResourceWithResult(fullId, {
                        revealOptions: { focus: false, select: false, expand: false }
                    }))?.id, expected);

                    const tree = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
                    assert.strictEqual((await tree.findItemById(fullId))?.id, expected);
                } finally {
                    disposable.dispose();
                }
            });
        }
    }
});
