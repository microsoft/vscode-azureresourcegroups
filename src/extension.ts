/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeDataProvider, callWithTelemetryAndErrorHandling, createApiProvider, createAzExtOutputChannel, IActionContext, registerUIExtensionVariables } from '@microsoft/vscode-azext-utils';
import { AzureExtensionApiProvider } from '@microsoft/vscode-azext-utils/api';
import * as vscode from 'vscode';
import { AppResource } from './api';
import { InternalAzureResourceGroupsExtensionApi } from './api/AzureResourceGroupsExtensionApi';
import { registerApplicationResourceProvider } from './api/registerApplicationResourceProvider';
import { registerApplicationResourceResolver } from './api/registerApplicationResourceResolver';
import { registerLocalResourceProvider } from './api/regsiterLocalResourceProvider';
import { revealTreeItem } from './api/revealTreeItem';
import { AzureResourceProvider } from './AzureResourceProvider';
import { registerCommands } from './commands/registerCommands';
import { registerTagDiagnostics } from './commands/tags/registerTagDiagnostics';
import { TagFileSystem } from './commands/tags/TagFileSystem';
import { azureResourceProviderId } from './constants';
import { ext } from './extensionVariables';
import { installableAppResourceResolver } from './resolvers/InstallableAppResourceResolver';
import { noopResolver } from './resolvers/NoopResolver';
import { shallowResourceResolver } from './resolvers/ShallowResourceResolver';
import { AzureAccountTreeItem } from './tree/AzureAccountTreeItem';
import { HelpTreeItem } from './tree/HelpTreeItem';
import { OperationsTreeItem } from './tree/operations/OperationsTreeItem';
import { WorkspaceTreeItem } from './tree/WorkspaceTreeItem';
import { delay } from './utils/delay';
import { ExtensionActivationManager } from './utils/ExtensionActivationManager';

export async function activateInternal(context: vscode.ExtensionContext, perfStats: { loadStartTime: number; loadEndTime: number }, ignoreBundle?: boolean): Promise<AzureExtensionApiProvider> {
    ext.context = context;
    ext.ignoreBundle = ignoreBundle;
    ext.outputChannel = createAzExtOutputChannel('Azure Resource Groups', ext.prefix);
    context.subscriptions.push(ext.outputChannel);

    registerUIExtensionVariables(ext);
    registerAzureUtilsExtensionVariables(ext);

    await callWithTelemetryAndErrorHandling('azureResourceGroups.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        ext.rootAccountTreeItem = new AzureAccountTreeItem();
        context.subscriptions.push(ext.rootAccountTreeItem);
        ext.tree = new AzExtTreeDataProvider(ext.rootAccountTreeItem, 'azureResourceGroups.loadMore');
        ext.treeView = vscode.window.createTreeView('azureResourceGroups', { treeDataProvider: ext.tree, showCollapseAll: true, canSelectMany: true });
        context.subscriptions.push(ext.treeView);

        ext.tagFS = new TagFileSystem(ext.tree);
        context.subscriptions.push(vscode.workspace.registerFileSystemProvider(TagFileSystem.scheme, ext.tagFS));
        registerTagDiagnostics();

        const helpTreeItem: HelpTreeItem = new HelpTreeItem();
        ext.helpTree = new AzExtTreeDataProvider(helpTreeItem, 'ms-azuretools.loadMore');
        context.subscriptions.push(vscode.window.createTreeView('ms-azuretools.helpAndFeedback', { treeDataProvider: ext.helpTree }));

        const workspaceTreeItem = new WorkspaceTreeItem();
        ext.workspaceTree = new AzExtTreeDataProvider(workspaceTreeItem, 'azureWorkspace.loadMore');
        context.subscriptions.push(vscode.window.createTreeView('azureWorkspace', { treeDataProvider: ext.workspaceTree }));

        const operationTreeItem = new OperationsTreeItem();
        ext.operationsTree = new AzExtTreeDataProvider(operationTreeItem, 'azureOperations.loadMore');
        context.subscriptions.push(vscode.window.createTreeView('azureOperations', { treeDataProvider: ext.operationsTree }));

        const task = async (): Promise<AppResource> => {
            await delay(5000);
            return {
                id: '/subscriptions/570117a0-fe37-4dde-ae48-b692c1b25f70/resourcegroups/angular-basic-dotnet/providers/microsoft.web/staticSites/angular-basic-dotnet',
                name: 'angular-basic-dotnet',
                type: 'microsoft.web/staticsites',
                location: 'West US 2',
            }
        };

        operationTreeItem.registerOperation(activateContext, {
            label: "Create static web app 'angular-basic-dotnet'",
            task,
        });

        await delay(1000);

        operationTreeItem.registerOperation(activateContext, {
            label: "Delete static web app 'angular-basic-02'",
            task: async () => {
                await delay(10000);
                throw new Error('Error deleting static web app');
            },
        });

        context.subscriptions.push(ext.activationManager = new ExtensionActivationManager());

        registerCommands();
        registerApplicationResourceProvider(azureResourceProviderId, new AzureResourceProvider());
        registerApplicationResourceResolver('vscode-azureresourcegroups.noopResolver', noopResolver);
        registerApplicationResourceResolver('vscode-azureresourcegroups.installableAppResourceResolver', installableAppResourceResolver);
        registerApplicationResourceResolver('vscode-azureresourcegroups.shallowResourceResolver', shallowResourceResolver);
    });

    return createApiProvider([
        new InternalAzureResourceGroupsExtensionApi({
            apiVersion: '0.0.1',
            tree: ext.tree,
            treeView: ext.treeView,
            revealTreeItem,
            registerApplicationResourceResolver,
            registerLocalResourceProvider,
        })
    ]);
}

export function deactivateInternal(): void {
    ext.diagnosticWatcher?.dispose();
}
