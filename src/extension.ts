/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeDataProvider, callWithTelemetryAndErrorHandling, createApiProvider, createAzExtOutputChannel, IActionContext, registerUIExtensionVariables } from '@microsoft/vscode-azext-utils';
import { AzureExtensionApi, AzureExtensionApiProvider } from '@microsoft/vscode-azext-utils/api';
import * as vscode from 'vscode';
import { registerApplicationResourceProvider } from './api/registerApplicationResourceProvider';
import { registerApplicationResourceResolver } from './api/registerApplicationResourceResolver';
import { AzureResourceProvider } from './AzureResourceProvider';
import { registerCommands } from './commands/registerCommands';
import { registerTagDiagnostics } from './commands/tags/registerTagDiagnostics';
import { TagFileSystem } from './commands/tags/TagFileSystem';
import { ext } from './extensionVariables';
import { AzureAccountTreeItem } from './tree/AzureAccountTreeItem';
import { HelpTreeItem } from './tree/HelpTreeItem';
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

        const accountTreeItem: AzureAccountTreeItem = new AzureAccountTreeItem();
        context.subscriptions.push(accountTreeItem);
        ext.tree = new AzExtTreeDataProvider(accountTreeItem, 'azureResourceGroups.loadMore');
        context.subscriptions.push(vscode.window.createTreeView('azureResourceGroups', { treeDataProvider: ext.tree, showCollapseAll: true, canSelectMany: true }));

        ext.tagFS = new TagFileSystem(ext.tree);
        context.subscriptions.push(vscode.workspace.registerFileSystemProvider(TagFileSystem.scheme, ext.tagFS));
        registerTagDiagnostics();

        const helpTreeItem: HelpTreeItem = new HelpTreeItem();
        ext.helpTree = new AzExtTreeDataProvider(helpTreeItem, 'ms-azuretools.loadMore');
        context.subscriptions.push(vscode.window.createTreeView('ms-azuretools.helpAndFeedback', { treeDataProvider: ext.helpTree }));

        context.subscriptions.push(ext.activationManager = new ExtensionActivationManager());

        registerCommands();
        registerApplicationResourceProvider(new AzureResourceProvider());
    });

    return createApiProvider([
        <AzureExtensionApi>{
            apiVersion: '0.0.1',
            registerApplicationResourceResolver
        }
    ]);
}

export function deactivateInternal(): void {
    ext.diagnosticWatcher?.dispose();
}
