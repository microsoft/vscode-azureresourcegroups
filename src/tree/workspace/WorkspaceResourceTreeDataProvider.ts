/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { WorkspaceResource } from '../../../api/src/index';
import { WorkspaceResourceProviderManager } from '../../api/ResourceProviderManagers';
import { localize } from '../../utils/localize';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { BranchDataItemWrapper } from '../BranchDataItemWrapper';
import { GenericItem } from '../GenericItem';
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
        } else {
            const children: ResourceGroupsItem[] = [];
            const resources = await this.resourceProviderManager.getResources();
            if (resources.length === 0) {
                await vscode.commands.executeCommand('setContext', 'azureWorkspace.state', this.resourceProviderManager.hasResourceProviders ? 'noWorkspaceResources' : 'noWorkspaceResourceProviders');
            } else {
                children.push(...await Promise.all(resources.map(resource => this.getWorkspaceItemModel(resource))));
                if (vscode.workspace.workspaceFolders === undefined || vscode.workspace.workspaceFolders.length === 0) {
                    children.push(new GenericItem(localize('openFolderOrWorkspace', 'Open folder or workspace...'), {
                        iconPath: new vscode.ThemeIcon('folder'),
                        commandId: 'workbench.action.openRecent'
                    }));
                }
            }

            // NOTE: Returning zero children indicates to VS Code that is should display a "welcome view".
            //       The one chosen for display depends on the context set above.
            return children;
        }
    }

    private async getWorkspaceItemModel(resource: WorkspaceResource): Promise<ResourceGroupsItem> {
        const branchDataProvider = this.branchDataProviderManager.getProvider(resource.resourceType);
        const resourceItem = await branchDataProvider.getResourceItem(resource);
        return new BranchDataItemWrapper(resourceItem, branchDataProvider, this.itemCache);
    }
}
