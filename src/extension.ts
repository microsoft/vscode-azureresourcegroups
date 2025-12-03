/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { LocationListStep, registerAzureUtilsExtensionVariables, setupAzureLogger } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeDataProvider, AzureExtensionApiFactory, IActionContext, callWithTelemetryAndErrorHandling, createApiProvider, createAzExtLogOutputChannel, createExperimentationService, registerUIExtensionVariables } from '@microsoft/vscode-azext-utils';
import { AzureSubscription } from 'api/src';
import { GetApiOptions, apiUtils } from 'api/src/utils/apiUtils';
import * as vscode from 'vscode';
import { AzExtResourceType } from '../api/src/AzExtResourceType';
import { DefaultAzureResourceProvider } from './api/DefaultAzureResourceProvider';
import { ResourceGroupsExtensionManager } from './api/ResourceGroupsExtensionManager';
import { ActivityLogResourceProviderManager, AzureResourceProviderManager, TenantResourceProviderManager, WorkspaceResourceProviderManager } from './api/ResourceProviderManagers';
import { InternalAzureResourceGroupsExtensionApi } from './api/compatibility/AzureResourceGroupsExtensionApi';
import { CompatibleAzExtTreeDataProvider } from './api/compatibility/CompatibleAzExtTreeDataProvider';
import { createCompatibilityPickAppResource } from './api/compatibility/pickAppResource';
import { registerApplicationResourceResolver } from './api/compatibility/registerApplicationResourceResolver';
import { registerWorkspaceResourceProvider } from './api/compatibility/registerWorkspaceResourceProvider';
import { createAzureResourcesHostApi } from './api/createAzureResourcesHostApi';
import { createWrappedAzureResourcesExtensionApi } from './api/createWrappedAzureResourcesExtensionApi';
import { registerChatStandInParticipantIfNeeded } from './chat/chatStandIn';
import { registerLMTools } from './chat/tools/registerLMTools';
import { createCloudConsole } from './cloudConsole/cloudConsole';
import { registerActivity } from './commands/activities/registerActivity';
import { registerActivityLogTree } from './commands/activities/registerActivityLogTree';
import { createResourceGroup } from './commands/createResourceGroup';
import { deleteResourceGroupV2 } from './commands/deleteResourceGroup/v2/deleteResourceGroupV2';
import { registerCommands } from './commands/registerCommands';
import { TagFileSystem } from './commands/tags/TagFileSystem';
import { registerTagDiagnostics } from './commands/tags/registerTagDiagnostics';
import { registerExportAuthRecordOnSessionChange } from './exportAuthRecord';
import { ext } from './extensionVariables';
import { AzureResourcesApiInternal } from './hostapi.v2.internal';
import { ManagedIdentityBranchDataProvider } from './managedIdentity/ManagedIdentityBranchDataProvider';
import { survey } from './nps';
import { getSubscriptionProviderFactory } from './services/getSubscriptionProviderFactory';
import { TestApi } from './testApi';
import { BranchDataItemCache } from './tree/BranchDataItemCache';
import { HelpTreeItem } from './tree/HelpTreeItem';
import { TreeDataItem } from './tree/ResourceGroupsItem';
import { ActivityLogResourceBranchDataProviderManager } from './tree/activityLog/ActivityLogBranchDataProviderManager';
import { ActivityLogDefaultBranchDataProvider } from './tree/activityLog/ActivityLogDefaultBranchDataProvider';
import { AzureResourceBranchDataProviderManager } from './tree/azure/AzureResourceBranchDataProviderManager';
import { DefaultAzureResourceBranchDataProvider } from './tree/azure/DefaultAzureResourceBranchDataProvider';
import { registerAzureTree } from './tree/azure/registerAzureTree';
import { registerFocusTree } from './tree/azure/registerFocusTree';
import { TenantDefaultBranchDataProvider } from './tree/tenants/TenantDefaultBranchDataProvider';
import { TenantResourceBranchDataProviderManager } from './tree/tenants/TenantResourceBranchDataProviderManager';
import { registerTenantTree } from './tree/tenants/registerTenantTree';
import { WorkspaceDefaultBranchDataProvider } from './tree/workspace/WorkspaceDefaultBranchDataProvider';
import { WorkspaceResourceBranchDataProviderManager } from './tree/workspace/WorkspaceResourceBranchDataProviderManager';
import { registerWorkspaceTree } from './tree/workspace/registerWorkspaceTree';
import { createResourceClient } from './utils/azureClients';

export async function activate(context: vscode.ExtensionContext, perfStats: { loadStartTime: number; loadEndTime: number }): Promise<apiUtils.AzureExtensionApiProvider> {
    // the entry point for vscode.dev is this activate, not main.js, so we need to instantiate perfStats here
    // the perf stats don't matter for vscode because there is no main file to load-- we may need to see if we can track the download time
    perfStats ||= { loadStartTime: Date.now(), loadEndTime: Date.now() };

    ext.context = context;
    ext.outputChannel = createAzExtLogOutputChannel('Azure Resource Groups');
    context.subscriptions.push(ext.outputChannel);
    context.subscriptions.push(setupAzureLogger(ext.outputChannel));

    registerUIExtensionVariables(ext);
    registerAzureUtilsExtensionVariables(ext);

    const refreshAzureTreeEmitter = new vscode.EventEmitter<void | TreeDataItem | TreeDataItem[] | null | undefined>();
    context.subscriptions.push(refreshAzureTreeEmitter);
    const refreshFocusTreeEmitter = new vscode.EventEmitter<void | TreeDataItem | TreeDataItem[] | null | undefined>();
    context.subscriptions.push(refreshFocusTreeEmitter);
    const refreshWorkspaceTreeEmitter = new vscode.EventEmitter<void | TreeDataItem | TreeDataItem[] | null | undefined>();
    context.subscriptions.push(refreshWorkspaceTreeEmitter);
    const refreshTenantTreeEmitter = new vscode.EventEmitter<void | TreeDataItem | TreeDataItem[] | null | undefined>();
    context.subscriptions.push(refreshTenantTreeEmitter);
    const refreshActivityLogTreeEmitter = new vscode.EventEmitter<void | TreeDataItem | TreeDataItem[] | null | undefined>();
    context.subscriptions.push(refreshActivityLogTreeEmitter);

    ext.actions.refreshWorkspaceTree = (data) => refreshWorkspaceTreeEmitter.fire(data);
    ext.actions.refreshAzureTree = (data) => refreshAzureTreeEmitter.fire(data);
    ext.actions.refreshFocusTree = (data) => refreshFocusTreeEmitter.fire(data);
    ext.actions.refreshTenantTree = (data) => refreshTenantTreeEmitter.fire(data);
    ext.actions.refreshActivityLogTree = (data) => refreshActivityLogTreeEmitter.fire(data);

    await callWithTelemetryAndErrorHandling('azureResourceGroups.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;


        ext.subscriptionProviderFactory = getSubscriptionProviderFactory(activateContext);

        ext.tagFS = new TagFileSystem(ext.appResourceTree);
        context.subscriptions.push(vscode.workspace.registerFileSystemProvider(TagFileSystem.scheme, ext.tagFS));
        registerTagDiagnostics();

        ext.experimentationService = await createExperimentationService(context);

        const helpTreeItem: HelpTreeItem = new HelpTreeItem();
        ext.helpTree = new AzExtTreeDataProvider(helpTreeItem, 'ms-azuretools.loadMore');
        context.subscriptions.push(vscode.window.createTreeView('ms-azuretools.helpAndFeedback', { treeDataProvider: ext.helpTree }));

        context.subscriptions.push(vscode.window.registerTerminalProfileProvider('azureResourceGroups.cloudShellBash', {
            provideTerminalProfile: async (token: vscode.CancellationToken) => {
                return createCloudConsole(await ext.subscriptionProviderFactory(), 'Linux', token).terminalProfile;
            }
        }));
        context.subscriptions.push(vscode.window.registerTerminalProfileProvider('azureResourceGroups.cloudShellPowerShell', {
            provideTerminalProfile: async (token: vscode.CancellationToken) => {
                return createCloudConsole(await ext.subscriptionProviderFactory(), 'Windows', token).terminalProfile;
            }
        }));

        registerCommands();
        survey(context);

        registerChatStandInParticipantIfNeeded(context);
        registerLMTools();
    });

    const extensionManager = new ResourceGroupsExtensionManager();

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
    const activityLogResourceBranchDataProviderManager = new ActivityLogResourceBranchDataProviderManager(new ActivityLogDefaultBranchDataProvider());
    const activityLogResourceProviderManager = new ActivityLogResourceProviderManager(async () => { return undefined; });

    const tenantResourceBranchDataProviderManager = new TenantResourceBranchDataProviderManager(
        new TenantDefaultBranchDataProvider());
    const tenantResourceProviderManager = new TenantResourceProviderManager(async () => { return undefined; });

    const azureResourcesBranchDataItemCache = new BranchDataItemCache();
    const azureResourceTreeDataProvider = registerAzureTree(context, {
        azureResourceProviderManager,
        azureResourceBranchDataProviderManager,
        refreshEvent: refreshAzureTreeEmitter.event,
        itemCache: azureResourcesBranchDataItemCache
    });

    ext.focusViewTreeDataProvider = registerFocusTree(context, {
        azureResourceProviderManager,
        azureResourceBranchDataProviderManager,
        refreshEvent: refreshFocusTreeEmitter.event,
        itemCache: azureResourcesBranchDataItemCache
    });

    const workspaceResourceTreeDataProvider = registerWorkspaceTree(context, {
        workspaceResourceProviderManager,
        workspaceResourceBranchDataProviderManager,
        refreshEvent: refreshWorkspaceTreeEmitter.event,
    });

    const tenantResourcesBranchDataItemCache = new BranchDataItemCache();
    registerTenantTree(context, {
        tenantResourceProviderManager,
        tenantResourceBranchDataProviderManager,
        refreshEvent: refreshTenantTreeEmitter.event,
        itemCache: tenantResourcesBranchDataItemCache
    });

    ext.activityLogTree = registerActivityLogTree(context, {
        activityLogResourceProviderManager,
        activityLogResourceBranchDataProviderManager,
        refreshEvent: refreshActivityLogTreeEmitter.event
    });

    const v2ApiFactory: AzureExtensionApiFactory<AzureResourcesApiInternal> = {
        apiVersion: '2.0.0',
        createApi: (options?: GetApiOptions) => {
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
                options?.extensionId ?? 'unknown'
            );
        }
    };

    ext.v2.api = v2ApiFactory.createApi({ extensionId: 'ms-azuretools.vscode-azureresourcegroups' });
    ext.managedIdentityBranchDataProvider = new ManagedIdentityBranchDataProvider();
    ext.v2.api.resources.registerAzureResourceBranchDataProvider(AzExtResourceType.ManagedIdentityUserAssignedIdentities, ext.managedIdentityBranchDataProvider);

    // Register exportAuthRecord callback for session changes and call once on activation
    registerExportAuthRecordOnSessionChange(context);

    ext.appResourceTree = new CompatibleAzExtTreeDataProvider(azureResourceTreeDataProvider);
    ext.workspaceTree = new CompatibleAzExtTreeDataProvider(workspaceResourceTreeDataProvider);

    const getSubscriptions: (filter: boolean) => Promise<AzureSubscription[]> =
        async (filter: boolean) => { return await (await ext.subscriptionProviderFactory()).getSubscriptions(filter); };

    const apiFactories: AzureExtensionApiFactory[] = [
        {
            apiVersion: InternalAzureResourceGroupsExtensionApi.apiVersion,
            createApi: () => new InternalAzureResourceGroupsExtensionApi({
                apiVersion: InternalAzureResourceGroupsExtensionApi.apiVersion,
                appResourceTree: ext.appResourceTree,
                appResourceTreeView: ext.appResourceTreeView,
                workspaceResourceTree: ext.workspaceTree,
                workspaceResourceTreeView: ext.workspaceTreeView,
                registerApplicationResourceResolver,
                registerWorkspaceResourceProvider,
                registerActivity,
                pickAppResource: createCompatibilityPickAppResource(),
                getSubscriptions,
            }),
        },
        v2ApiFactory,
        /**
         * This is a temporary API and will be removed in a future version once the staged introduction
         * of the "DocumentDB for VS Code" extension is complete.
         *
         * The 3.0.0 API is *NOT* backward-compatible with 2.0.0 on purpose to prevent API users from upgrading to this
         * temporary API.
         *
         * Its primary purpose is to support the user migration from the Azure Databases extension to the Azure DocumentDB extension.
         * It provides a feature flag that allows dependent extensions (e.g., `vscode-cosmosdb`, `vscode-documentdb`) to detect
         * when this new functionality is available.
         *
         * This API-based signal is necessary due to a staged rollout, allowing users time to upgrade.
         * Dependent extensions should rely on this API signal rather than the extension version.
         *
         * This temporary API will be removed in a future version once the migration is complete.
         */
        {
            apiVersion: "3.0.0",
            createApi: () => {
                return {
                    apiVersion: "3.0.0",
                    isDocumentDbExtensionSupportEnabled: () => true,
                };
            },
        } as AzureExtensionApiFactory
    ];

    // Add test API when running tests
    // This allows tests to access internal extension state
    if (process.env.VSCODE_RUNNING_TESTS) {
        const testApiFactory: AzureExtensionApiFactory<TestApi> = {
            apiVersion: '99.0.0',
            createApi: () => ({
                apiVersion: '99.0.0',
                getApi: () => ext.v2.api,
                compatibility: {
                    getAppResourceTree: () => ext.appResourceTree,
                },
                extensionVariables: {
                    getOutputChannel: () => ext.outputChannel,
                },
                testing: {
                    setOverrideAzureServiceFactory: (factory) => {
                        ext.testing.overrideAzureServiceFactory = factory;
                    },
                    setOverrideAzureSubscriptionProvider: (provider) => {
                        ext.testing.overrideAzureSubscriptionProvider = provider;
                    },
                    getLocations: (context) => {
                        return LocationListStep.getLocations(context);
                    },
                    createResourceGroup: (context, node) => {
                        return createResourceGroup(context, node);
                    },
                    deleteResourceGroupV2: (context) => {
                        return deleteResourceGroupV2(context);
                    },
                    resourceGroupExists: async (context, node, rgName) => {
                        const client = await createResourceClient([context, node.subscription]);
                        try {
                            await client.resourceGroups.get(rgName);
                            return true;
                        } catch {
                            return false;
                        }
                    }
                },
            }),
        };
        apiFactories.push(testApiFactory);
    }

    return createApiProvider(apiFactories);
}

export function deactivate(): void {
    ext.diagnosticWatcher?.dispose();
}
