/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkspaceResource } from '@microsoft/vscode-azext-utils/hostapi.v2';
import * as vscode from 'vscode';
import { WorkspaceResourceProviderManager } from '../../../api/v2/ResourceProviderManagers';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { BranchDataProviderItem } from '../BranchDataProviderItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from '../ResourceTreeDataProviderBase';
import { WorkspaceResourceBranchDataProviderManager } from './WorkspaceResourceBranchDataProviderManager';

export class WorkspaceResourceTreeDataProvider extends ResourceTreeDataProviderBase {
    constructor(
        private readonly branchDataProviderManager: WorkspaceResourceBranchDataProviderManager,
        onRefresh: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
        private readonly resourceProviderManager: WorkspaceResourceProviderManager,
        branchItemCache: BranchDataItemCache) {
        super(
            branchItemCache,
            branchDataProviderManager.onDidChangeTreeData,
            resourceProviderManager.onDidChangeResourceChange,
            onRefresh);
    }

    async onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        if (element) {
            return await element.getChildren();
        }
        else {
            if (vscode.workspace.workspaceFolders === undefined || vscode.workspace.workspaceFolders.length === 0) {
                await vscode.commands.executeCommand('setContext', 'azureWorkspace.state', 'noWorkspace');
            }
            else {
                const resources: WorkspaceResource[] = [];
                resources.push(...await this.resourceProviderManager.getResources(undefined));
                await Promise.all(vscode.workspace.workspaceFolders.map(async workspaceFolder => {
                    resources.push(...await this.resourceProviderManager.getResources(workspaceFolder));
                }));

                if (resources.length === 0) {
                    await vscode.commands.executeCommand('setContext', 'azureWorkspace.state', this.resourceProviderManager.hasResourceProviders ? 'noWorkspaceResources' : 'noWorkspaceResourceProviders');
                } else {
                    return Promise.all(resources.map(resource => this.getWorkspaceItemModel(resource)));
                }
            }
        }

        // NOTE: Returning zero children indicates to VS Code that is should display a "welcome view".
        //       The one chosen for display depends on the context set above.

        return [];
    }

    private async getWorkspaceItemModel(resource: WorkspaceResource): Promise<ResourceGroupsItem> {
        const branchDataProvider = this.branchDataProviderManager.getProvider(resource.resourceType);

        const resourceItem = await branchDataProvider.getResourceItem(resource);

        return new BranchDataProviderItem(resourceItem, branchDataProvider, this.itemCache);
    }
}
