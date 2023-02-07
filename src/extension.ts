/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeDataProvider, AzureExtensionApiFactory, callWithTelemetryAndErrorHandling, createApiProvider, createAzExtOutputChannel, IActionContext, registerUIExtensionVariables } from '@microsoft/vscode-azext-utils';
import type { AppResourceResolver } from '@microsoft/vscode-azext-utils/hostapi';
import { apiUtils, GetApiOptions } from 'api/src/utils/apiUtils';
import * as vscode from 'vscode';
import { AzureResourcesApiInternal } from '../hostapi.v2.internal';
import { ActivityLogTreeItem } from './activityLog/ActivityLogsTreeItem';
import { registerActivity } from './activityLog/registerActivity';
import { InternalAzureResourceGroupsExtensionApi } from './api/compatibility/AzureResourceGroupsExtensionApi';
import { CompatibleAzExtTreeDataProvider } from './api/compatibility/CompatibleAzExtTreeDataProvider';
import { createCompatibilityPickAppResource } from './api/compatibility/pickAppResource';
import { registerApplicationResourceResolver } from './api/compatibility/registerApplicationResourceResolver';
import { registerWorkspaceResourceProvider } from './api/compatibility/registerWorkspaceResourceProvider';
import { createAzureResourcesHostApi } from './api/createAzureResourcesHostApi';
import { createWrappedAzureResourcesExtensionApi } from './api/createWrappedAzureResourcesExtensionApi';
import { DefaultAzureResourceProvider } from './api/DefaultAzureResourceProvider';
import { ResourceGroupsExtensionManager } from './api/ResourceGroupsExtensionManager';
import { AzureResourceProviderManager, WorkspaceResourceProviderManager } from './api/ResourceProviderManagers';
import { registerCommands } from './commands/registerCommands';
import { registerTagDiagnostics } from './commands/tags/registerTagDiagnostics';
import { TagFileSystem } from './commands/tags/TagFileSystem';
import { ext } from './extensionVariables';
import { VSCodeAzureSubscriptionProvider } from './services/AzureSubscriptionProvider';
import { AzureResourceBranchDataProviderManager } from './tree/azure/AzureResourceBranchDataProviderManager';
import { DefaultAzureResourceBranchDataProvider } from './tree/azure/DefaultAzureResourceBranchDataProvider';
import { registerAzureTree } from './tree/azure/registerAzureTree';
import { BranchDataItemCache } from './tree/BranchDataItemCache';
import { HelpTreeItem } from './tree/HelpTreeItem';
import { ResourceGroupsItem } from './tree/ResourceGroupsItem';
import { registerWorkspaceTree } from './tree/workspace/registerWorkspaceTree';
import { WorkspaceDefaultBranchDataProvider } from './tree/workspace/WorkspaceDefaultBranchDataProvider';
import { WorkspaceResourceBranchDataProviderManager } from './tree/workspace/WorkspaceResourceBranchDataProviderManager';

export async function activate(context: vscode.ExtensionContext, _perfStats: { loadStartTime: number; loadEndTime: number }, ignoreBundle?: boolean): Promise<apiUtils.AzureExtensionApiProvider> {
    ext.context = context;
    ext.ignoreBundle = ignoreBundle;
    ext.outputChannel = createAzExtOutputChannel('Azure Resource Groups', ext.prefix);
    context.subscriptions.push(ext.outputChannel);

    await registerUIExtensionVariables(ext);
    registerAzureUtilsExtensionVariables(ext);

    const refreshAzureTreeEmitter = new vscode.EventEmitter<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>();
    context.subscriptions.push(refreshAzureTreeEmitter);
    const refreshWorkspaceTreeEmitter = new vscode.EventEmitter<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>();
    context.subscriptions.push(refreshWorkspaceTreeEmitter);

    ext.actions.refreshWorkspaceTree = (data) => refreshWorkspaceTreeEmitter.fire(data);
    ext.actions.refreshAzureTree = (data) => refreshAzureTreeEmitter.fire(data);

    await callWithTelemetryAndErrorHandling('azureResourceGroups.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        // TODO: Get perfTime working again
        // activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        setupEvents(context);
        ext.subscriptionProvider = new VSCodeAzureSubscriptionProvider(context.globalState);

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

    const azureResourcesBranchDataItemCache = new BranchDataItemCache();
    const azureResourceTreeDataProvider = registerAzureTree(context, {
        azureResourceProviderManager,
        azureResourceBranchDataProviderManager,
        refreshEvent: refreshAzureTreeEmitter.event,
        itemCache: azureResourcesBranchDataItemCache
    });

    const workspaceResourceTreeDataProvider = registerWorkspaceTree(context, {
        workspaceResourceProviderManager,
        workspaceResourceBranchDataProviderManager,
        refreshEvent: refreshWorkspaceTreeEmitter.event,
    });

    const v2ApiFactory: AzureExtensionApiFactory<AzureResourcesApiInternal> = {
        apiVersion: '2.0.0',
        createApi: (options: GetApiOptions) => {
            return createWrappedAzureResourcesExtensionApi(
                {
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
                },
                options.extensionId ?? 'unknown'
            );
        }
    };

    ext.v2.api = v2ApiFactory.createApi({ extensionId: 'ms-azuretools.vscode-azureresourcegroups' });

    return createApiProvider(
        [
            {
                apiVersion: InternalAzureResourceGroupsExtensionApi.apiVersion,
                createApi: () => new InternalAzureResourceGroupsExtensionApi({
                    apiVersion: InternalAzureResourceGroupsExtensionApi.apiVersion,
                    appResourceTree: new CompatibleAzExtTreeDataProvider(azureResourceTreeDataProvider),
                    appResourceTreeView: ext.appResourceTreeView,
                    workspaceResourceTree: new CompatibleAzExtTreeDataProvider(workspaceResourceTreeDataProvider),
                    workspaceResourceTreeView: ext.workspaceTreeView,
                    registerApplicationResourceResolver,
                    registerWorkspaceResourceProvider,
                    registerActivity,
                    pickAppResource: createCompatibilityPickAppResource(azureResourcesBranchDataItemCache),
                }),
            },
            v2ApiFactory,
        ]
    );
}

export function deactivate(): void {
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
