/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { WorkspaceResourceProviderManager } from '../../../api/v2/ResourceProviderManagers';
import { localize } from './../../../utils/localize';
import { WorkspaceResourceBranchDataProviderManager } from './WorkspaceResourceBranchDataProviderManager';
import { WorkspaceResourceTreeDataProvider } from './WorkspaceResourceTreeDataProvider';

interface RegisterWorkspaceTreeOptions {
    workspaceResourceBranchDataProviderManager: WorkspaceResourceBranchDataProviderManager,
    refreshEvent: vscode.Event<void>,
    workspaceResourceProviderManager: WorkspaceResourceProviderManager
}

interface RegisterWorkspaceTreeResult {
    workspaceResourceTreeDataProvider: WorkspaceResourceTreeDataProvider;
}

export function registerWorkspaceTree(context: vscode.ExtensionContext, options: RegisterWorkspaceTreeOptions): RegisterWorkspaceTreeResult {
    const { workspaceResourceBranchDataProviderManager, workspaceResourceProviderManager, refreshEvent } = options;

    const workspaceResourceTreeDataProvider =
        new WorkspaceResourceTreeDataProvider(workspaceResourceBranchDataProviderManager, refreshEvent, workspaceResourceProviderManager);
    context.subscriptions.push(workspaceResourceTreeDataProvider);

    const treeView = vscode.window.createTreeView('azureWorkspace', {
        canSelectMany: true,
        showCollapseAll: true,
        treeDataProvider: workspaceResourceTreeDataProvider,
    });
    context.subscriptions.push(treeView);

    treeView.description = localize('local', 'Local');

    return { workspaceResourceTreeDataProvider };
}
