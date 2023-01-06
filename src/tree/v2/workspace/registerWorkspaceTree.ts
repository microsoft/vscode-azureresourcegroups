/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { WorkspaceResourceProviderManager } from '../../../api/v2/ResourceProviderManagers';
import { ext } from '../../../extensionVariables';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { createTreeView } from '../createTreeView';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { wrapTreeForVSCode } from '../wrapTreeForVSCode';
import { localize } from './../../../utils/localize';
import { WorkspaceResourceBranchDataProviderManager } from './WorkspaceResourceBranchDataProviderManager';
import { WorkspaceResourceTreeDataProvider } from './WorkspaceResourceTreeDataProvider';

interface RegisterWorkspaceTreeOptions {
    workspaceResourceBranchDataProviderManager: WorkspaceResourceBranchDataProviderManager,
    workspaceResourceProviderManager: WorkspaceResourceProviderManager,
    refreshEvent: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
}

export function registerWorkspaceTree(context: vscode.ExtensionContext, options: RegisterWorkspaceTreeOptions): WorkspaceResourceTreeDataProvider {
    const { workspaceResourceBranchDataProviderManager, workspaceResourceProviderManager, refreshEvent } = options;

    const branchItemCache = new BranchDataItemCache();
    const workspaceResourceTreeDataProvider =
        new WorkspaceResourceTreeDataProvider(workspaceResourceBranchDataProviderManager, refreshEvent, workspaceResourceProviderManager, branchItemCache);
    context.subscriptions.push(workspaceResourceTreeDataProvider);

    const treeView = createTreeView('azureWorkspace', {
        canSelectMany: true,
        showCollapseAll: true,
        description: localize('local', 'Local'),
        itemCache: branchItemCache,
        treeDataProvider: wrapTreeForVSCode(workspaceResourceTreeDataProvider, branchItemCache),
        findItemById: workspaceResourceTreeDataProvider.findItemById.bind(workspaceResourceTreeDataProvider) as typeof workspaceResourceTreeDataProvider.findItemById,
    });
    context.subscriptions.push(treeView);

    treeView.description = localize('local', 'Local');

    ext.workspaceTreeView = treeView as unknown as vscode.TreeView<AzExtTreeItem>;

    return workspaceResourceTreeDataProvider;
}
