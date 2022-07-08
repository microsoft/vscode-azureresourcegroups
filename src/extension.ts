/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeDataProvider, AzExtTreeItem, callWithTelemetryAndErrorHandling, createApiProvider, createAzExtOutputChannel, IActionContext, registerEvent, registerUIExtensionVariables } from '@microsoft/vscode-azext-utils';
import { AzureExtensionApiProvider } from '@microsoft/vscode-azext-utils/api';
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
import { ApplicationResourceProviderManager } from './api/v2/providers/ApplicationResourceProviderManager';
import { BuiltInApplicationResourceProvider } from './api/v2/providers/BuiltInApplicationResourceProvider';
import { ResourceGroupsExtensionManager } from './api/v2/ResourceGroupsExtensionManager';
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
import { BranchDataProviderManager } from './tree/v2/providers/BranchDataProviderManager';
import { BuiltInApplicationResourceBranchDataProvider } from './tree/v2/providers/BuiltInApplicationResourceBranchDataProvider';
import { registerResourceGroupsTreeV2 } from './tree/v2/registerResourceGroupsTreeV2';
import { WorkspaceTreeItem } from './tree/WorkspaceTreeItem';
import { ExtensionActivationManager } from './utils/ExtensionActivationManager';
import { localize } from './utils/localize';

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

        registerCommands();
        registerApplicationResourceProvider(azureResourceProviderId, new AzureResourceProvider());
        registerApplicationResourceResolver('vscode-azureresourcegroups.wrapperResolver', wrapperResolver);
        registerApplicationResourceResolver('vscode-azureresourcegroups.installableAppResourceResolver', installableAppResourceResolver);
        registerApplicationResourceResolver('vscode-azureresourcegroups.shallowResourceResolver', shallowResourceResolver);

        await vscode.commands.executeCommand('setContext', 'azure-account.signedIn', await ext.rootAccountTreeItem.getIsLoggedIn());
    });

    const branchDataProviderManager = new BranchDataProviderManager(
        new BuiltInApplicationResourceBranchDataProvider(),
        new ResourceGroupsExtensionManager());

    context.subscriptions.push(branchDataProviderManager);

    const resourceProviderManager = new ApplicationResourceProviderManager();

    registerResourceGroupsTreeV2(context, branchDataProviderManager, resourceProviderManager);

    const v2Api = new V2AzureResourcesApiImplementation(
        branchDataProviderManager,
        resourceProviderManager);

    context.subscriptions.push(v2Api.registerApplicationResourceProvider('TODO: is ID useful?', new BuiltInApplicationResourceProvider()));

    return createApiProvider([
        new InternalAzureResourceGroupsExtensionApi({
            apiVersion: '0.0.1',
            appResourceTree: ext.appResourceTree,
            appResourceTreeView: ext.appResourceTreeView,
            workspaceResourceTree: ext.workspaceTree,
            workspaceResourceTreeView: ext.workspaceTreeView,
            revealTreeItem,
            registerApplicationResourceResolver,
            registerWorkspaceResourceProvider,
            registerActivity,
            pickAppResource,
        }),
        v2Api
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
