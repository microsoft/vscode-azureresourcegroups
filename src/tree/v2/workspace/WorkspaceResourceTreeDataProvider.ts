/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { WorkspaceResourceProviderManager } from '../../../api/v2/ResourceproviderManagerBase';
import { WorkspaceResource } from '../../../api/v2/v2AzureResourcesApi';
import { BranchDataProviderItem } from '../BranchDataProviderItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceGroupsItemCache } from '../ResourceGroupsItemCache';
import { ResourceTreeDataProviderBase } from '../ResourceTreeDataProviderBase';
import { WorkspaceResourceBranchDataProviderManager } from './WorkspaceResourceBranchDataProviderManager';

export class WorkspaceResourceTreeDataProvider extends ResourceTreeDataProviderBase {
    constructor(
        private readonly branchDataProviderManager: WorkspaceResourceBranchDataProviderManager,
        onRefresh: vscode.Event<void>,
        private readonly resourceProviderManager: WorkspaceResourceProviderManager) {
        super(
            new ResourceGroupsItemCache(),
            branchDataProviderManager.onDidChangeTreeData,
            resourceProviderManager.onDidChangeResourceChange,
            onRefresh);
    }

    async onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        if (element) {
            return await element.getChildren();
        }
        else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const resources = await this.resourceProviderManager.getResources(vscode.workspace.workspaceFolders[0]);

            if (resources) {
                return Promise.all(resources.map(resource => this.getWorkspaceItemModel(resource)));
            }
        }

        return [];
    }

    private async getWorkspaceItemModel(resource: WorkspaceResource): Promise<ResourceGroupsItem> {
        const branchDataProvider = this.branchDataProviderManager.getProvider(resource.type);

        const resourceItem = await branchDataProvider.getResourceItem(resource);

        return new BranchDataProviderItem(resourceItem, branchDataProvider, this.itemCache);
    }
}
