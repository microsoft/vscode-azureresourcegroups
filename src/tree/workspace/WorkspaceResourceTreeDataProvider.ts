/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { WorkspaceResource } from '../../../api/src/index';
import { WorkspaceResourceProviderManager } from '../../api/ResourceProviderManagers';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { BranchDataItemWrapper } from '../BranchDataProviderItem';
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
                const resources = await this.resourceProviderManager.getResources();
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

        if (!resourceItem) {
            throw new UnexpectedNullishReturnValueError('getResourceItem', resourceItem);
        }

        return new BranchDataItemWrapper(resourceItem, branchDataProvider, this.itemCache);
    }
}

export class UnexpectedNullishReturnValueError extends Error {
    constructor(functionName: string, value: never) {
        super(`Internal error: ${functionName} returned ${String(value)}. Expected a non-nullish value.`);
    }
}
