/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
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

suite('Most-specific enumerated ARM resource routing', () => {
    const disposables: vscode.Disposable[] = [];

    teardown(() => {
        while (disposables.length) {
            disposables.pop()?.dispose();
        }
        getCachedTestApi().testing.setOverrideAzureServiceFactory(undefined);
        getCachedTestApi().testing.setOverrideAzureSubscriptionProvider(undefined);
    });

    for (const grouping of ['resourceGroup', 'resourceType']) {
        for (const parentBehavior of ['empty', 'failure', 'cancellation']) {
            for (const target of ['database', 'provider child']) {
                test(`${grouping} routes to the ${target} without loading its ${parentBehavior} ARM parent`, async () => {
                    const resources = createMockSubscriptionWithFunctions();
                    const service = createMockAzureResourcesServiceFactory(resources)();
                    const serverId = `${resources.sub1.rg1.id}/providers/Microsoft.Sql/servers/Server`;
                    const databaseId = `${serverId}/databases/Zoo`;
                    const schemaId = `${databaseId}/schemas`;
                    const childId = `${schemaId}/orders`;
                    let parentLoads = 0;
                    let databaseLoads = 0;
                    getCachedTestApi().testing.setOverrideAzureServiceFactory(() => ({
                        ...service,
                        listResources: async (_context, subscription) => subscription.subscriptionId === resources.sub1.subscriptionId ? [
                            { id: serverId, name: 'Server', type: 'Microsoft.Sql/servers', location: 'westus2' },
                            { id: databaseId, name: 'Server/Zoo', type: 'Microsoft.Sql/servers/databases', location: 'westus2' }
                        ] : []
                    }));
                    const parentProvider: BranchDataProvider<AzureResource, RevealNode> = {
                        getResourceItem: resource => {
                            parentLoads++;
                            if (parentBehavior !== 'empty') {
                                throw parentBehavior === 'failure' ? new Error('Server provider unavailable') : new UserCancelledError();
                            }
                            return { id: resource.id };
                        },
                        getChildren: () => [],
                        getTreeItem: node => new vscode.TreeItem(node.id)
                    };
                    const databaseProvider: BranchDataProvider<AzureResource, RevealNode> = {
                        getResourceItem: resource => {
                            databaseLoads++;
                            return { id: resource.id };
                        },
                        getChildren: node => {
                            if (node.id === databaseId) {
                                return [{ id: schemaId, parent: node }];
                            }
                            return node.id === schemaId ? [{ id: childId, parent: node }] : [];
                        },
                        getTreeItem: node => new vscode.TreeItem(node.id),
                        getParent: node => node.parent
                    };
                    disposables.push(
                        api().registerAzureResourceBranchDataProvider(AzExtResourceType.SqlServers, parentProvider),
                        api().registerAzureResourceBranchDataProvider(AzExtResourceType.SqlDatabases, databaseProvider),
                        getCachedTestApi().testing.overrideAzureResourceReveal(async () => { /* accepted by VS Code */ })
                    );
                    await vscode.commands.executeCommand(`azureResourceGroups.groupBy.${grouping}`);
                    const subscriptions = await new MockAzureSubscriptionProvider(resources).getAvailableSubscriptions();
                    const subscription = subscriptions.find(item => item.subscriptionId === resources.sub1.subscriptionId);
                    assert.ok(subscription);
                    const targetId = target === 'database' ? databaseId : childId;
                    const requestId = target === 'database' ? databaseId.toUpperCase() : `${databaseId.toUpperCase()}/schemas/orders`;
                    const result = await api().revealAzureResourceWithResult(requestId);
                    assert.strictEqual(result?.id, getAccountAndTenantPrefix(subscription) + targetId);
                    assert.strictEqual(result?.resource?.id, targetId);
                    assert.strictEqual(parentLoads, 0);
                    assert.strictEqual(databaseLoads, 1);

                    if (grouping === 'resourceGroup' && parentBehavior === 'empty') {
                        const tree = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
                        const group = await tree.findItemById(resources.sub1.rg1.id);
                        assert.ok(group);
                        const children = await tree.getChildren(group);
                        assert.ok(children?.some(item => item.id === getAccountAndTenantPrefix(subscription) + serverId));
                        assert.ok(children?.some(item => item.id === getAccountAndTenantPrefix(subscription) + databaseId));
                    }
                });
            }
        }
    }
});
