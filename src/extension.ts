/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeDataProvider, callWithTelemetryAndErrorHandling, createAzExtOutputChannel, IActionContext, registerUIExtensionVariables } from '@microsoft/vscode-azext-utils';
import type { AppResourceResolver } from '@microsoft/vscode-azext-utils/hostapi';
import * as vscode from 'vscode';
import { AzureResourcesApiInternal } from '../hostapi.v2.internal';
import { ActivityLogTreeItem } from './activityLog/ActivityLogsTreeItem';
import { registerActivity } from './activityLog/registerActivity';
import { InternalAzureResourceGroupsExtensionApi } from './api/AzureResourceGroupsExtensionApi';
import { pickAppResource } from './api/pickAppResource';
import { registerApplicationResourceResolver } from './api/registerApplicationResourceResolver';
import { registerWorkspaceResourceProvider } from './api/registerWorkspaceResourceProvider';
import { revealTreeItem } from './api/revealTreeItem';
import { CompatibleAzExtTreeDataProvider } from './api/v2/compatibility/CompatibleAzExtTreeDataProvider';
import { createAzureResourcesHostApi } from './api/v2/createAzureResourcesHostApi';
import { DefaultAzureResourceProvider } from './api/v2/DefaultAzureResourceProvider';
import { ResourceGroupsExtensionManager } from './api/v2/ResourceGroupsExtensionManager';
import { AzureResourceProviderManager, WorkspaceResourceProviderManager } from './api/v2/ResourceProviderManagers';
import { AzureResourcesApiManager } from './api/v2/v2AzureResourcesApi';
import { registerCommands } from './commands/registerCommands';
import { registerTagDiagnostics } from './commands/tags/registerTagDiagnostics';
import { TagFileSystem } from './commands/tags/TagFileSystem';
import { ext } from './extensionVariables';
import { HelpTreeItem } from './tree/HelpTreeItem';
import { AzureResourceBranchDataProviderManager } from './tree/v2/azure/AzureResourceBranchDataProviderManager';
import { DefaultAzureResourceBranchDataProvider } from './tree/v2/azure/DefaultAzureResourceBranchDataProvider';
import { registerAzureTree } from './tree/v2/azure/registerAzureTree';
import { registerWorkspaceTree } from './tree/v2/workspace/registerWorkspaceTree';
import { WorkspaceDefaultBranchDataProvider } from './tree/v2/workspace/WorkspaceDefaultBranchDataProvider';
import { WorkspaceResourceBranchDataProviderManager } from './tree/v2/workspace/WorkspaceResourceBranchDataProviderManager';
import { createApiProvider } from './utils/v2/apiUtils';

let v2Api: AzureResourcesApiInternal | undefined = undefined;

export async function activateInternal(context: vscode.ExtensionContext, perfStats: { loadStartTime: number; loadEndTime: number }, ignoreBundle?: boolean): Promise<AzureResourcesApiManager> {
    ext.context = context;
    ext.ignoreBundle = ignoreBundle;
    ext.outputChannel = createAzExtOutputChannel('Azure Resource Groups', ext.prefix);
    context.subscriptions.push(ext.outputChannel);

    registerUIExtensionVariables(ext);
    registerAzureUtilsExtensionVariables(ext);

    const refreshAzureTreeEmitter = new vscode.EventEmitter<void>();
    context.subscriptions.push(refreshAzureTreeEmitter);
    const refreshWorkspaceTreeEmitter = new vscode.EventEmitter<void>();
    context.subscriptions.push(refreshWorkspaceTreeEmitter);

    ext.actions.refreshWorkspaceTree = () => refreshWorkspaceTreeEmitter.fire();
    ext.actions.refreshAzureTree = () => refreshAzureTreeEmitter.fire();

    await callWithTelemetryAndErrorHandling('azureResourceGroups.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        setupEvents(context);

        ext.tagFS = new TagFileSystem(ext.appResourceTree);
        context.subscriptions.push(vscode.workspace.registerFileSystemProvider(TagFileSystem.scheme, ext.tagFS));
        registerTagDiagnostics();

        const helpTreeItem: HelpTreeItem = new HelpTreeItem();
        ext.helpTree = new AzExtTreeDataProvider(helpTreeItem, 'ms-azuretools.loadMore');
        context.subscriptions.push(vscode.window.createTreeView('ms-azuretools.helpAndFeedback', { treeDataProvider: ext.helpTree }));

        context.subscriptions.push(ext.activityLogTreeItem = new ActivityLogTreeItem());
        ext.activityLogTree = new AzExtTreeDataProvider(ext.activityLogTreeItem, 'azureActivityLog.loadMore');
        context.subscriptions.push(vscode.window.createTreeView('azureActivityLog', { treeDataProvider: ext.activityLogTree }));

        registerCommands();
    });

    const extensionManager = new ResourceGroupsExtensionManager()

    const azureResourceBranchDataProviderManager = new AzureResourceBranchDataProviderManager(
        new DefaultAzureResourceBranchDataProvider(),
        type => void extensionManager.activateApplicationResourceBranchDataProvider(type));

    context.subscriptions.push(azureResourceBranchDataProviderManager);

    const azureResourceProviderManager = new AzureResourceProviderManager(() => extensionManager.activateApplicationResourceProviders());

    azureResourceProviderManager.addResourceProvider(new DefaultAzureResourceProvider());

    const workspaceResourceBranchDataProviderManager = new WorkspaceResourceBranchDataProviderManager(
        new WorkspaceDefaultBranchDataProvider(),
        type => void extensionManager.activateWorkspaceResourceBranchDataProvider(type));
    const workspaceResourceProviderManager = new WorkspaceResourceProviderManager(() => extensionManager.activateWorkspaceResourceProviders());

    const azureResourceTreeDataProvider = registerAzureTree(context, {
        azureResourceProviderManager,
        azureResourceBranchDataProviderManager,
        refreshEvent: refreshAzureTreeEmitter.event,
    });

    const workspaceResourceTreeDataProvider = registerWorkspaceTree(context, {
        workspaceResourceProviderManager,
        workspaceResourceBranchDataProviderManager,
        refreshEvent: refreshAzureTreeEmitter.event,
    });

    const v2ApiFactory = () => {
        if (v2Api === undefined) {
            v2Api = {
                apiVersion: '2.0.0',
                resources: createAzureResourcesHostApi(
                    azureResourceProviderManager,
                    azureResourceBranchDataProviderManager,
                    azureResourceTreeDataProvider,
                    workspaceResourceProviderManager,
                    workspaceResourceBranchDataProviderManager,
                    workspaceResourceTreeDataProvider,
                ),
                activity: {
                    registerActivity
                },
            }
        }

        return v2Api;
    }

    ext.v2.api = v2ApiFactory();

    return createApiProvider(
        (<{ version: string }>context.extension.packageJSON).version,
        [
            {
                apiVersion: InternalAzureResourceGroupsExtensionApi.apiVersion,
                apiFactory: () => new InternalAzureResourceGroupsExtensionApi(
                    {
                        apiVersion: InternalAzureResourceGroupsExtensionApi.apiVersion,
                        appResourceTree: new CompatibleAzExtTreeDataProvider(azureResourceTreeDataProvider),
                        appResourceTreeView: ext.appResourceTreeView,
                        workspaceResourceTree: new CompatibleAzExtTreeDataProvider(workspaceResourceTreeDataProvider),
                        workspaceResourceTreeView: ext.workspaceTreeView,
                        revealTreeItem,
                        registerApplicationResourceResolver,
                        registerWorkspaceResourceProvider,
                        registerActivity,
                        pickAppResource,
                    })
            },
            {
                apiVersion: '2.0.0',
                apiFactory: v2ApiFactory
            }
        ]);
}

export function deactivateInternal(): void {
    ext.diagnosticWatcher?.dispose();
}

function setupEvents(context: vscode.ExtensionContext): void {
    // Event emitter for when a group is focused/unfocused
    context.subscriptions.push(ext.emitters.onDidChangeFocusedGroup = new vscode.EventEmitter());
    ext.events.onDidChangeFocusedGroup = ext.emitters.onDidChangeFocusedGroup.event;

    // Event emitter for when an AppResourceResolver is registered
    context.subscriptions.push(ext.emitters.onDidRegisterResolver = new vscode.EventEmitter<AppResourceResolver>());
    ext.events.onDidRegisterResolver = ext.emitters.onDidRegisterResolver.event;
}
