/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { WorkspaceResourceProviderManager } from '../../../api/v2/ResourceProviderManagers';
import { ext } from '../../../extensionVariables';
import { createTreeView } from '../createTreeView';
import { localize } from './../../../utils/localize';
import { WorkspaceResourceBranchDataProviderManager } from './WorkspaceResourceBranchDataProviderManager';
import { WorkspaceResourceTreeDataProvider } from './WorkspaceResourceTreeDataProvider';

interface RegisterWorkspaceTreeOptions {
    branchDataProviderManager: WorkspaceResourceBranchDataProviderManager,
    refreshEvent: vscode.Event<void>,
    workspaceResourceProviderManager: WorkspaceResourceProviderManager
}

interface RegisterWorkspaceTreeResult {
    workspaceResourceTreeDataProvider: WorkspaceResourceTreeDataProvider;
}

export function registerWorkspaceTree(context: vscode.ExtensionContext, options: RegisterWorkspaceTreeOptions): RegisterWorkspaceTreeResult {
    const { branchDataProviderManager, refreshEvent, workspaceResourceProviderManager } = options;

    const workspaceResourceTreeDataProvider = new WorkspaceResourceTreeDataProvider(
        branchDataProviderManager,
        refreshEvent,
        workspaceResourceProviderManager);

    context.subscriptions.push(workspaceResourceTreeDataProvider);

    ext.v2.workspaceResourceTree = workspaceResourceTreeDataProvider;

    const treeView = createTreeView('azureWorkspace', {
        treeDataProvider: workspaceResourceTreeDataProvider,
        canSelectMany: true,
        showCollapseAll: true,
        description: localize('local', 'Local'),
    });

    context.subscriptions.push(treeView);

    ext.workspaceTreeView = treeView as unknown as vscode.TreeView<AzExtTreeItem>;

    return {
        workspaceResourceTreeDataProvider
    }
}
