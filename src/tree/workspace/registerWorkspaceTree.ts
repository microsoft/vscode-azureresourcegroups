/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { WorkspaceResourceProviderManager } from '../../api/ResourceProviderManagers';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { createTreeView } from '../createTreeView';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { wrapTreeForVSCode } from '../wrapTreeForVSCode';
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
        itemCache: branchItemCache,
        description: localize('local', 'Local'),
        title: localize('workspace', 'Workspace'),
        treeDataProvider: wrapTreeForVSCode(workspaceResourceTreeDataProvider, branchItemCache),
        findItemById: workspaceResourceTreeDataProvider.findItemById.bind(workspaceResourceTreeDataProvider) as typeof workspaceResourceTreeDataProvider.findItemById,
    });
    context.subscriptions.push(treeView);

    ext.workspaceTreeView = treeView as unknown as vscode.TreeView<AzExtTreeItem>;

    return workspaceResourceTreeDataProvider;
}
