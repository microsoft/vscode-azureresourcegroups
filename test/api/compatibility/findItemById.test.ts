/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import assert = require('assert');
import { randomUUID } from 'crypto';
import { commands, TreeItem } from 'vscode';
import { AzExtResourceType, AzureResource, BranchDataProvider, ext, IActionContext, ResourceModelBase } from '../../../extension.bundle';
import { api } from '../api';
import { createMockSubscriptionWithFunctions } from '../mockServiceFactory';

suite('findItemById', () => {

    async function testFindItemById(): Promise<void> {
        const mocks = createMockSubscriptionWithFunctions();
        const azureResourceBranchDataProvider: BranchDataProvider<AzureResource, ResourceModelBase> = {
            getResourceItem: (resource: AzureResource): ResourceModelBase => {
                return {
                    id: resource.id,
                }
            },
            getChildren: (_resource: AzureResource): AzureResource[] => {
                return [];
            },
            getTreeItem: (resource: AzureResource): TreeItem => {
                return new TreeItem(resource.name);
            }
        }

        api().registerAzureResourceBranchDataProvider(AzExtResourceType.FunctionApp, azureResourceBranchDataProvider);

        const treeItem = await ext.appResourceTree.findTreeItem(mocks.functionApp1.id, {} as unknown as IActionContext);
        assert.ok(treeItem);
        assert.strictEqual(treeItem.id, mocks.functionApp1.id);
    }

    test('Can find based on ARM id while grouped by type', async () => {
        await commands.executeCommand('azureResourceGroups.groupBy.resourceType');
        await testFindItemById();
    });

    test('Can find based on ARM id while grouped by resource group', async () => {
        await commands.executeCommand('azureResourceGroups.groupBy.resourceGroup');
        await testFindItemById();
    });

    test('Can find based on ARM id while grouped by location', async () => {
        await commands.executeCommand('azureResourceGroups.groupBy.location');
        await testFindItemById();
    });

    // needed for default resource to deploy feature
    test('Can find item based on v1 tree item id', async () => {
        const mocks = createMockSubscriptionWithFunctions();
        const azureResourceBranchDataProvider: BranchDataProvider<AzureResource, ResourceModelBase> = {
            getResourceItem: (resource: AzureResource): ResourceModelBase => {
                return {
                    id: resource.id,
                }
            },
            getChildren: (_resource: AzureResource): AzureResource[] => {
                return [];
            },
            getTreeItem: (resource: AzureResource): TreeItem => {
                return new TreeItem(resource.name);
            }
        }

        api().registerAzureResourceBranchDataProvider(AzExtResourceType.FunctionApp, azureResourceBranchDataProvider);
        await commands.executeCommand('azureResourceGroups.groupBy.resourceType');

        const treeItem = await ext.appResourceTree.findTreeItem(`/subscriptions/${randomUUID()}/FunctionApps/${mocks.functionApp1.id}`, {} as unknown as IActionContext);
        assert.ok(treeItem);
        assert.strictEqual(treeItem.id, mocks.functionApp1.id);
    });
});
