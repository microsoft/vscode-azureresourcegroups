/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeDataProvider, AzExtTreeItem, callWithTelemetryAndErrorHandling, createAzExtOutputChannel, IActionContext, registerEvent, registerUIExtensionVariables } from '@microsoft/vscode-azext-utils';
import type { AppResourceResolver } from '@microsoft/vscode-azext-utils/hostapi';
import * as vscode from 'vscode';
import { ActivityLogTreeItem } from './activityLog/ActivityLogsTreeItem';
import { registerActivity } from './activityLog/registerActivity';
import { InternalAzureResourceGroupsExtensionApi } from './api/AzureResourceGroupsExtensionApi';
import { pickAppResource } from './api/pickAppResource';
import { registerApplicationResourceProvider } from './api/registerApplicationResourceProvider';
import { registerApplicationResourceResolver } from './api/registerApplicationResourceResolver';
import { registerWorkspaceResourceProvider } from './api/registerWorkspaceResourceProvider';
import { revealTreeItem } from './api/revealTreeItem';
import { DefaultApplicationResourceProvider } from './api/v2/DefaultApplicationResourceProvider';
import { ResourceGroupsExtensionManager } from './api/v2/ResourceGroupsExtensionManager';
import { AzureResourceProviderManager, WorkspaceResourceProviderManager } from './api/v2/ResourceProviderManagers';
import { AzureResourcesApiManager } from './api/v2/v2AzureResourcesApi';
import { V2AzureResourcesApiImplementation } from './api/v2/v2AzureResourcesApiImplementation';
import { AzureResourceProvider } from './AzureResourceProvider';
import { registerCommands } from './commands/registerCommands';
import { registerTagDiagnostics } from './commands/tags/registerTagDiagnostics';
import { TagFileSystem } from './commands/tags/TagFileSystem';
import { azureResourceProviderId } from './constants';
import { ext } from './extensionVariables';
import { installableAppResourceResolver } from './resolvers/InstallableAppResourceResolver';
import { shallowResourceResolver } from './resolvers/ShallowResourceResolver';
import { wrapperResolver } from './resolvers/WrapperResolver';
import { AzureAccountTreeItem } from './tree/AzureAccountTreeItem';
import { GroupTreeItemBase } from './tree/GroupTreeItemBase';
import { HelpTreeItem } from './tree/HelpTreeItem';
import { AzureResourceBranchDataProviderManager } from './tree/v2/azure/AzureResourceBranchDataProviderManager';
import { DefaultAzureResourceBranchDataProvider } from './tree/v2/azure/DefaultAzureResourceBranchDataProvider';
import { registerResourceGroupsTreeV2 } from './tree/v2/azure/registerResourceGroupsTreeV2';
import { registerWorkspaceTreeV2 } from './tree/v2/workspace/registerWorkspaceTreeV2';
import { WorkspaceDefaultBranchDataProvider } from './tree/v2/workspace/WorkspaceDefaultBranchDataProvider';
import { WorkspaceResourceBranchDataProviderManager } from './tree/v2/workspace/WorkspaceResourceBranchDataProviderManager';
import { WorkspaceTreeItem } from './tree/WorkspaceTreeItem';
import { ExtensionActivationManager } from './utils/ExtensionActivationManager';
import { localize } from './utils/localize';
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

    const refreshWorkspaceEmitter = new vscode.EventEmitter<void>();

    context.subscriptions.push(refreshWorkspaceEmitter);

    await callWithTelemetryAndErrorHandling('azureResourceGroups.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        setupEvents(context);

        ext.rootAccountTreeItem = new AzureAccountTreeItem();
        context.subscriptions.push(ext.rootAccountTreeItem);
        ext.appResourceTree = new AzExtTreeDataProvider(ext.rootAccountTreeItem, 'azureResourceGroups.loadMore');
        context.subscriptions.push(ext.appResourceTreeView = vscode.window.createTreeView('azureResourceGroups', { treeDataProvider: ext.appResourceTree, showCollapseAll: true, canSelectMany: true }));
        ext.appResourceTreeView.description = localize('remote', 'Remote');
        context.subscriptions.push(ext.appResourceTree.trackTreeItemCollapsibleState(ext.appResourceTreeView));

        // Hook up the resolve handler
        registerEvent('treeItem.expanded', ext.appResourceTree.onDidExpandOrRefreshExpandedTreeItem, async (context: IActionContext, treeItem: AzExtTreeItem) => {
            context.errorHandling.suppressDisplay = true;

            if (treeItem instanceof GroupTreeItemBase) {
                await treeItem.resolveAllChildrenOnExpanded(context);
            }
        });

        ext.tagFS = new TagFileSystem(ext.appResourceTree);
        context.subscriptions.push(vscode.workspace.registerFileSystemProvider(TagFileSystem.scheme, ext.tagFS));
        registerTagDiagnostics();

        const helpTreeItem: HelpTreeItem = new HelpTreeItem();
        ext.helpTree = new AzExtTreeDataProvider(helpTreeItem, 'ms-azuretools.loadMore');
        context.subscriptions.push(vscode.window.createTreeView('ms-azuretools.helpAndFeedback', { treeDataProvider: ext.helpTree }));

        const workspaceTreeItem = new WorkspaceTreeItem();
        ext.workspaceTree = new AzExtTreeDataProvider(workspaceTreeItem, 'azureWorkspace.loadMore');
        context.subscriptions.push(ext.workspaceTreeView = vscode.window.createTreeView('azureWorkspace', { treeDataProvider: ext.workspaceTree, canSelectMany: true }));
        ext.workspaceTreeView.description = localize('local', 'Local');

        context.subscriptions.push(ext.activityLogTreeItem = new ActivityLogTreeItem());
        ext.activityLogTree = new AzExtTreeDataProvider(ext.activityLogTreeItem, 'azureActivityLog.loadMore');
        context.subscriptions.push(vscode.window.createTreeView('azureActivityLog', { treeDataProvider: ext.activityLogTree }));

        context.subscriptions.push(ext.activationManager = new ExtensionActivationManager());

        registerCommands(refreshEventEmitter, () => refreshWorkspaceEmitter.fire());
        registerApplicationResourceProvider(azureResourceProviderId, new AzureResourceProvider());
        registerApplicationResourceResolver('vscode-azureresourcegroups.wrapperResolver', wrapperResolver);
        registerApplicationResourceResolver('vscode-azureresourcegroups.installableAppResourceResolver', installableAppResourceResolver);
        registerApplicationResourceResolver('vscode-azureresourcegroups.shallowResourceResolver', shallowResourceResolver);

        await vscode.commands.executeCommand('setContext', 'azure-account.signedIn', await ext.rootAccountTreeItem.getIsLoggedIn());
    });

    const extensionManager = new ResourceGroupsExtensionManager()

    const branchDataProviderManager = new AzureResourceBranchDataProviderManager(
        new DefaultAzureResourceBranchDataProvider(),
        type => void extensionManager.activateApplicationResourceBranchDataProvider(type));

    context.subscriptions.push(branchDataProviderManager);

    const applicationResourceProviderManager = new AzureResourceProviderManager(() => extensionManager.activateApplicationResourceProviders());

    applicationResourceProviderManager.addResourceProvider(new DefaultApplicationResourceProvider());

    const workspaceResourceBranchDataProviderManager = new WorkspaceResourceBranchDataProviderManager(
        new WorkspaceDefaultBranchDataProvider(),
        type => void extensionManager.activateWorkspaceResourceBranchDataProvider(type));
    const workspaceResourceProviderManager = new WorkspaceResourceProviderManager(() => extensionManager.activateWorkspaceResourceProviders());

    registerResourceGroupsTreeV2(
        context,
        branchDataProviderManager,
        refreshEventEmitter.event,
        applicationResourceProviderManager);

    registerWorkspaceTreeV2(
        workspaceResourceBranchDataProviderManager,
        context,
        refreshWorkspaceEmitter.event,
        workspaceResourceProviderManager);

    const v2ApiFactory = () => {
        if (v2Api === undefined) {
            v2Api = new V2AzureResourcesApiImplementation(
                applicationResourceProviderManager,
                branchDataProviderManager,
                workspaceResourceProviderManager,
                workspaceResourceBranchDataProviderManager);
        }

        return v2Api;
    }

    return createApiProvider(
        (<{ version: string }>context.extension.packageJSON).version,
        [
            {
                apiVersion: InternalAzureResourceGroupsExtensionApi.apiVersion,
                apiFactory: () => new InternalAzureResourceGroupsExtensionApi(
                    {
                        apiVersion: InternalAzureResourceGroupsExtensionApi.apiVersion,
                        appResourceTree: ext.appResourceTree,
                        appResourceTreeView: ext.appResourceTreeView,
                        workspaceResourceTree: ext.workspaceTree,
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
