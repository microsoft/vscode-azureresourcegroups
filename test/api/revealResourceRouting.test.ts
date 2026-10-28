/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import * as vscode from 'vscode';
import { AzExtResourceType, AzureResource, BranchDataProvider, ResourceModelBase } from '../../api/src';
import type { TreeDataItem } from '../../src/tree/ResourceGroupsItem';
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
                    const siblingDatabaseId = `${serverId}/databases/Alpha`;
                    const schemaId = `${databaseId}/schemas`;
                    const childId = `${schemaId}/orders`;
                    let parentLoads = 0;
                    let databaseLoads = 0;
                    getCachedTestApi().testing.setOverrideAzureServiceFactory(() => ({
                        ...service,
                        listResources: async (_context, subscription) => subscription.subscriptionId === resources.sub1.subscriptionId ? [
                            { id: serverId, name: 'Server', type: 'Microsoft.Sql/servers', location: 'westus2' },
                            { id: databaseId, name: 'Server/Zoo', type: 'Microsoft.Sql/servers/databases', location: 'westus2' },
                            { id: siblingDatabaseId, name: 'Server/Alpha', type: 'Microsoft.Sql/servers/databases', location: 'westus2' }
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

                    if (parentBehavior === 'empty') {
                        const tree = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
                        const navigation: vscode.TreeDataProvider<TreeDataItem> = tree;
                        const qualifiedTarget = getAccountAndTenantPrefix(subscription) + targetId;
                        let node: TreeDataItem | null | undefined = await tree.findItemById(qualifiedTarget,
                            { propagateErrors: true, targetId: qualifiedTarget });
                        assert.ok(node);
                        while (node.id !== getAccountAndTenantPrefix(subscription) + databaseId) {
                            node = await navigation.getParent?.(node);
                            assert.ok(node);
                        }
                        // Use the parent retained by explicit resolution, not a fresh lookup of the group.
                        const group = await navigation.getParent?.(node);
                        assert.ok(group);
                        const children = await tree.getChildren(group);
                        assert.ok(children?.some(item => item.id === getAccountAndTenantPrefix(subscription) + databaseId));
                        assert.ok(children?.some(item => item.id === getAccountAndTenantPrefix(subscription) + siblingDatabaseId));
                        if (grouping === 'resourceGroup') {
                            assert.ok(children?.some(item => item.id === getAccountAndTenantPrefix(subscription) + serverId));
                        }

                        if (grouping === 'resourceGroup') {
                            assert.strictEqual((await api().revealAzureResourceWithResult(resources.sub1.rg1.id))?.id,
                                getAccountAndTenantPrefix(subscription) + resources.sub1.rg1.id);
                        }
                    }

                });
            }
        }
    }

    for (const grouping of ['resourceGroup', 'resourceType']) {
        for (const hideWhenGroupedByType of [true, false]) {
            for (const target of ['database', 'provider child']) {
                test(`${grouping} resolves the ${target} with hideWhenGroupedByType=${hideWhenGroupedByType}`, async () => {
                    const resources = createMockSubscriptionWithFunctions();
                    const service = createMockAzureResourcesServiceFactory(resources)();
                    const serverId = `${resources.sub1.rg1.id}/providers/Microsoft.Sql/servers/Server`;
                    const siblingServerId = `${resources.sub1.rg1.id}/providers/Microsoft.Sql/servers/Other`;
                    const databaseId = `${serverId}/databases/Inventory`;
                    const siblingDatabaseId = `${serverId}/databases/Other`;
                    const childId = `${databaseId}/orders`;
                    const throughParent = grouping === 'resourceType' && hideWhenGroupedByType;
                    const server: RevealNode = { id: serverId };
                    const database: RevealNode = { id: databaseId, parent: server };
                    const child: RevealNode = { id: childId, parent: database };
                    let parentLoads = 0;
                    let databaseLoads = 0;

                    getCachedTestApi().testing.setOverrideAzureServiceFactory(() => ({
                        ...service,
                        listResources: async (_context, subscription) => subscription.subscriptionId === resources.sub1.subscriptionId ? [
                            { id: serverId, name: 'Server', type: 'Microsoft.Sql/servers', location: 'westus2' },
                            { id: siblingServerId, name: 'Other', type: 'Microsoft.Sql/servers', location: 'westus2' },
                            { id: databaseId, name: 'Server/Inventory', type: 'Microsoft.Sql/servers/databases', location: 'westus2' },
                            { id: siblingDatabaseId, name: 'Server/Other', type: 'Microsoft.Sql/servers/databases', location: 'westus2' }
                        ] : []
                    }));
                    const parentProvider: BranchDataProvider<AzureResource, RevealNode> = {
                        getResourceItem: resource => {
                            parentLoads++;
                            return resource.id === serverId ? server : { id: resource.id };
                        },
                        getChildren: node => node === server ? [database] : node === database ? [child] : [],
                        getTreeItem: node => new vscode.TreeItem(node.id),
                        getParent: node => node.parent
                    };
                    const databaseProvider: BranchDataProvider<AzureResource, RevealNode> = {
                        getResourceItem: resource => {
                            databaseLoads++;
                            assert.ok(!throughParent, 'A hidden resource type must not load its own provider');
                            return resource.id === databaseId ? database : { id: resource.id };
                        },
                        getChildren: node => node === database ? [child] : [],
                        getTreeItem: node => new vscode.TreeItem(node.id),
                        getParent: node => node.parent
                    };
                    disposables.push(
                        getCachedTestApi().testing.overrideResourceType(AzExtResourceType.SqlDatabases, { hideWhenGroupedByType }),
                        api().registerAzureResourceBranchDataProvider(AzExtResourceType.SqlServers, parentProvider),
                        api().registerAzureResourceBranchDataProvider(AzExtResourceType.SqlDatabases, databaseProvider),
                        getCachedTestApi().testing.overrideAzureResourceReveal(async () => { /* accepted by VS Code */ })
                    );
                    await vscode.commands.executeCommand(`azureResourceGroups.groupBy.${grouping}`);
                    const subscriptions = await new MockAzureSubscriptionProvider(resources).getAvailableSubscriptions();
                    const subscription = subscriptions.find(item => item.subscriptionId === resources.sub1.subscriptionId);
                    assert.ok(subscription);
                    const prefix = getAccountAndTenantPrefix(subscription);
                    const tree = api().azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
                    const navigation: vscode.TreeDataProvider<TreeDataItem> = tree;
                    const subscriptionNode = await tree.findItemById(`${prefix}${resources.sub1.id}`);
                    assert.ok(subscriptionNode);
                    const groups = await tree.getChildren(subscriptionNode);
                    if (grouping === 'resourceType') {
                        assert.strictEqual(groups?.some(group => group.id?.endsWith(`/groupings/${AzExtResourceType.SqlDatabases}`)),
                            !hideWhenGroupedByType, 'Respect contribution visibility in ordinary browsing');
                    }

                    const targetId = target === 'database' ? databaseId : childId;
                    const result = await api().revealAzureResourceWithResult(targetId);
                    assert.strictEqual(result?.id, prefix + targetId);
                    assert.strictEqual(result?.resource, target === 'database' ? database : child);
                    assert.strictEqual(parentLoads, throughParent ? 1 : 0);
                    assert.strictEqual(databaseLoads, throughParent ? 0 : 1);

                    const qualifiedTarget = prefix + targetId;
                    let node: TreeDataItem | null | undefined = await tree.findItemById(qualifiedTarget,
                        { propagateErrors: true, targetId: qualifiedTarget });
                    assert.ok(node);
                    const branchRootId = prefix + (throughParent ? serverId : databaseId);
                    while (node.id !== branchRootId) {
                        node = await navigation.getParent?.(node);
                        assert.ok(node);
                    }
                    const retainedGroup = await navigation.getParent?.(node);
                    assert.ok(retainedGroup);
                    const siblings = await tree.getChildren(retainedGroup);
                    assert.ok(siblings?.some(sibling => sibling.id === prefix + (throughParent ? siblingServerId : siblingDatabaseId)),
                        'The retained parent must still expose its other visible resources');
                });
            }
        }
    }
});
