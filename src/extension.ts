/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeDataProvider, callWithTelemetryAndErrorHandling, createAzExtOutputChannel, IActionContext, registerUIExtensionVariables } from '@microsoft/vscode-azext-utils';
import type { AppResourceResolver } from '@microsoft/vscode-azext-utils/hostapi';
import * as vscode from 'vscode';
import { ActivityLogTreeItem } from './activityLog/ActivityLogsTreeItem';
import { registerActivity } from './activityLog/registerActivity';
import { InternalAzureResourceGroupsExtensionApi } from './api/AzureResourceGroupsExtensionApi';
import { pickAppResource } from './api/pickAppResource';
import { registerApplicationResourceResolver } from './api/registerApplicationResourceResolver';
import { registerWorkspaceResourceProvider } from './api/registerWorkspaceResourceProvider';
import { revealTreeItem } from './api/revealTreeItem';
import { CompatibleAzExtTreeDataProvider } from './api/v2/compatibility/CompatibleAzExtTreeDataProvider';
import { DefaultApplicationResourceProvider } from './api/v2/DefaultApplicationResourceProvider';
import { ResourceGroupsExtensionManager } from './api/v2/ResourceGroupsExtensionManager';
import { ApplicationResourceProviderManager, WorkspaceResourceProviderManager } from './api/v2/ResourceProviderManagers';
import { AzureResourcesApiManager } from './api/v2/v2AzureResourcesApi';
import { V2AzureResourcesApiImplementation } from './api/v2/v2AzureResourcesApiImplementation';
import { registerCommands } from './commands/registerCommands';
import { registerTagDiagnostics } from './commands/tags/registerTagDiagnostics';
import { TagFileSystem } from './commands/tags/TagFileSystem';
import { ext } from './extensionVariables';
import { HelpTreeItem } from './tree/HelpTreeItem';
import { ApplicationResourceBranchDataProviderManager } from './tree/v2/application/ApplicationResourceBranchDataProviderManager';
import { DefaultApplicationResourceBranchDataProvider } from './tree/v2/application/DefaultApplicationResourceBranchDataProvider';
import { registerApplicationTree } from './tree/v2/application/registerResourceGroupsTreeV2';
import { registerWorkspaceTree } from './tree/v2/workspace/registerWorkspaceTreeV2';
import { WorkspaceDefaultBranchDataProvider } from './tree/v2/workspace/WorkspaceDefaultBranchDataProvider';
import { WorkspaceResourceBranchDataProviderManager } from './tree/v2/workspace/WorkspaceResourceBranchDataProviderManager';
import { createApiProvider } from './utils/v2/apiUtils';

let v2Api: V2AzureResourcesApiImplementation | undefined = undefined;

export async function activateInternal(context: vscode.ExtensionContext, perfStats: { loadStartTime: number; loadEndTime: number }, ignoreBundle?: boolean): Promise<AzureResourcesApiManager> {
    ext.context = context;
    ext.ignoreBundle = ignoreBundle;
    ext.outputChannel = createAzExtOutputChannel('Azure Resource Groups', ext.prefix);
    context.subscriptions.push(ext.outputChannel);

    registerUIExtensionVariables(ext);
    registerAzureUtilsExtensionVariables(ext);

    const refreshEventEmitter = new vscode.EventEmitter<void>();

    context.subscriptions.push(refreshEventEmitter);

    ext.emitters.refreshWorkspace = new vscode.EventEmitter<void>();

    context.subscriptions.push(ext.emitters.refreshWorkspace = new vscode.EventEmitter<void>());

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

        registerCommands(refreshEventEmitter, () => ext.emitters.refreshWorkspace.fire());
    });

    const extensionManager = new ResourceGroupsExtensionManager()

    const applicationResourceBranchDataProviderManager = new ApplicationResourceBranchDataProviderManager(
        new DefaultApplicationResourceBranchDataProvider(),
        type => void extensionManager.activateApplicationResourceBranchDataProvider(type));

    context.subscriptions.push(applicationResourceBranchDataProviderManager);

    const applicationResourceProviderManager = new ApplicationResourceProviderManager(() => extensionManager.activateApplicationResourceProviders());

    applicationResourceProviderManager.addResourceProvider(new DefaultApplicationResourceProvider());

    const workspaceResourceBranchDataProviderManager = new WorkspaceResourceBranchDataProviderManager(
        new WorkspaceDefaultBranchDataProvider(),
        type => void extensionManager.activateWorkspaceResourceBranchDataProvider(type));
    const workspaceResourceProviderManager = new WorkspaceResourceProviderManager(() => extensionManager.activateWorkspaceResourceProviders());

    const { applicationResourceTreeDataProvider } = registerApplicationTree(context, {
        branchDataProviderManager: applicationResourceBranchDataProviderManager,
        applicationResourceProviderManager: applicationResourceProviderManager,
        refreshEvent: refreshEventEmitter.event,
    });

    const { workspaceResourceTreeDataProvider } = registerWorkspaceTree(context, {
        workspaceResourceProviderManager,
        branchDataProviderManager: workspaceResourceBranchDataProviderManager,
        refreshEvent: ext.emitters.refreshWorkspace.event,
    });

    const v2ApiFactory = () => {
        if (v2Api === undefined) {
            v2Api = new V2AzureResourcesApiImplementation(
                applicationResourceProviderManager,
                applicationResourceBranchDataProviderManager,
                workspaceResourceProviderManager,
                workspaceResourceBranchDataProviderManager,
                applicationResourceTreeDataProvider,
                workspaceResourceTreeDataProvider
            );
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
                        appResourceTree: new CompatibleAzExtTreeDataProvider(applicationResourceTreeDataProvider),
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
                apiVersion: V2AzureResourcesApiImplementation.apiVersion,
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
