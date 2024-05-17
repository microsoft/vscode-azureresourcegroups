/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { AzureDevOpsSubscriptionProviderInitializer, createAzureDevOpsSubscriptionProviderFactory } from '@microsoft/vscode-azext-azureauth';
import { registerAzureUtilsExtensionVariables, setupAzureLogger } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeDataProvider, AzureExtensionApiFactory, IActionContext, callWithTelemetryAndErrorHandling, createApiProvider, createAzExtLogOutputChannel, createExperimentationService, registerUIExtensionVariables } from '@microsoft/vscode-azext-utils';
import { AzureSubscription } from 'api/src';
import { GetApiOptions, apiUtils } from 'api/src/utils/apiUtils';
import * as vscode from 'vscode';
import { ActivityLogTreeItem } from './activityLog/ActivityLogsTreeItem';
import { registerActivity } from './activityLog/registerActivity';
import { DefaultAzureResourceProvider } from './api/DefaultAzureResourceProvider';
import { ResourceGroupsExtensionManager } from './api/ResourceGroupsExtensionManager';
import { AzureResourceProviderManager, WorkspaceResourceProviderManager } from './api/ResourceProviderManagers';
import { InternalAzureResourceGroupsExtensionApi } from './api/compatibility/AzureResourceGroupsExtensionApi';
import { CompatibleAzExtTreeDataProvider } from './api/compatibility/CompatibleAzExtTreeDataProvider';
import { createCompatibilityPickAppResource } from './api/compatibility/pickAppResource';
import { registerApplicationResourceResolver } from './api/compatibility/registerApplicationResourceResolver';
import { registerWorkspaceResourceProvider } from './api/compatibility/registerWorkspaceResourceProvider';
import { createAzureResourcesHostApi } from './api/createAzureResourcesHostApi';
import { createWrappedAzureResourcesExtensionApi } from './api/createWrappedAzureResourcesExtensionApi';
import { createCloudConsole } from './cloudConsole/cloudConsole';
import { registerCommands } from './commands/registerCommands';
import { TagFileSystem } from './commands/tags/TagFileSystem';
import { registerTagDiagnostics } from './commands/tags/registerTagDiagnostics';
import { ext } from './extensionVariables';
import { AzureResourcesApiInternal } from './hostapi.v2.internal';
import { createVSCodeAzureSubscriptionProviderFactory } from './services/VSCodeAzureSubscriptionProvider';
import { BranchDataItemCache } from './tree/BranchDataItemCache';
import { HelpTreeItem } from './tree/HelpTreeItem';
import { ResourceGroupsItem } from './tree/ResourceGroupsItem';
import { AzureResourceBranchDataProviderManager } from './tree/azure/AzureResourceBranchDataProviderManager';
import { DefaultAzureResourceBranchDataProvider } from './tree/azure/DefaultAzureResourceBranchDataProvider';
import { registerAzureTree } from './tree/azure/registerAzureTree';
import { registerFocusTree } from './tree/azure/registerFocusTree';
import { WorkspaceDefaultBranchDataProvider } from './tree/workspace/WorkspaceDefaultBranchDataProvider';
import { WorkspaceResourceBranchDataProviderManager } from './tree/workspace/WorkspaceResourceBranchDataProviderManager';
import { registerWorkspaceTree } from './tree/workspace/registerWorkspaceTree';

export async function activate(context: vscode.ExtensionContext, perfStats: { loadStartTime: number; loadEndTime: number }, ignoreBundle?: boolean): Promise<apiUtils.AzureExtensionApiProvider> {
    // the entry point for vscode.dev is this activate, not main.js, so we need to instantiate perfStats here
    // the perf stats don't matter for vscode because there is no main file to load-- we may need to see if we can track the download time
    console.log("TEST: Starting activation");
    perfStats ||= { loadStartTime: Date.now(), loadEndTime: Date.now() };

    ext.context = context;
    ext.ignoreBundle = ignoreBundle;
    ext.outputChannel = createAzExtLogOutputChannel('Azure Resource Groups');
    context.subscriptions.push(ext.outputChannel);
    context.subscriptions.push(setupAzureLogger(ext.outputChannel));

    registerUIExtensionVariables(ext);
    registerAzureUtilsExtensionVariables(ext);

    const refreshAzureTreeEmitter = new vscode.EventEmitter<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>();
    context.subscriptions.push(refreshAzureTreeEmitter);
    const refreshFocusTreeEmitter = new vscode.EventEmitter<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>();
    context.subscriptions.push(refreshFocusTreeEmitter);
    const refreshWorkspaceTreeEmitter = new vscode.EventEmitter<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>();
    context.subscriptions.push(refreshWorkspaceTreeEmitter);

    ext.actions.refreshWorkspaceTree = (data) => refreshWorkspaceTreeEmitter.fire(data);
    ext.actions.refreshAzureTree = (data) => refreshAzureTreeEmitter.fire(data);
    ext.actions.refreshFocusTree = (data) => refreshFocusTreeEmitter.fire(data);

    console.log("TEST: Registering telemetry");
    await callWithTelemetryAndErrorHandling('azureResourceGroups.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        console.log("TEST: Registering subscription provider");
        // if this for a nightly test, we want to use the test subscription provider
        // TODO: Use the other environment variable to determine to use this. Currently set to true for testing reasons
        const longRunningTestsEnabled: boolean = true;//!/^(false|0)?$/i.test(process.env.ENABLE_LONG_RUNNING_TESTS || '')
        if (longRunningTestsEnabled) {
            try {
                console.log("TEST: Accessing env vars");
                const serviceConnectionId: string | undefined = process.env['AzCode_ServiceConnectionID'];
                console.log("TEST: Successfully accessed");
                const domain: string | undefined = process.env['AzCode_ServiceConnectionDomain'];
                const clientId: string | undefined = process.env['AzCode_ServiceConnectionClientID'];

                if (!serviceConnectionId || !domain || !clientId) {
                    throw new Error(`Using Azure DevOps federated credentials, but federated service connection is not configured\n
                        process.env.AzCodeServiceConnectionID: ${serviceConnectionId ? "✅" : "❌"}\n
                        process.env.AzCodeServiceConnectionDomain: ${domain ? "✅" : "❌"}\n
                        process.env.AzCodeServiceConnectionClientID: ${clientId ? "✅" : "❌"}\n
                    `);
                }

                const initializer: AzureDevOpsSubscriptionProviderInitializer = {
                    serviceConnectionId,
                    domain,
                    clientId,
                }
                ext.subscriptionProviderFactory = createAzureDevOpsSubscriptionProviderFactory(initializer);
                console.log("TEST: Success getting factory");
            } catch (error) {
                console.log(`TEST: Error getting factory: ${JSON.stringify(error)}`);
                throw error;
            }

        } else {
            ext.subscriptionProviderFactory = createVSCodeAzureSubscriptionProviderFactory();
        }

        ext.tagFS = new TagFileSystem(ext.appResourceTree);
        context.subscriptions.push(vscode.workspace.registerFileSystemProvider(TagFileSystem.scheme, ext.tagFS));
        registerTagDiagnostics();

        ext.experimentationService = await createExperimentationService(context);

        const helpTreeItem: HelpTreeItem = new HelpTreeItem();
        ext.helpTree = new AzExtTreeDataProvider(helpTreeItem, 'ms-azuretools.loadMore');
        context.subscriptions.push(vscode.window.createTreeView('ms-azuretools.helpAndFeedback', { treeDataProvider: ext.helpTree }));

        context.subscriptions.push(ext.activityLogTreeItem = new ActivityLogTreeItem());
        ext.activityLogTree = new AzExtTreeDataProvider(ext.activityLogTreeItem, 'azureActivityLog.loadMore');
        context.subscriptions.push(vscode.window.createTreeView('azureActivityLog', { treeDataProvider: ext.activityLogTree }));

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

        console.log("TEST: registering commands");
        registerCommands();
        console.log("TEST: Commands registered");
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

    ext.appResourceTree = new CompatibleAzExtTreeDataProvider(azureResourceTreeDataProvider);
    ext.workspaceTree = new CompatibleAzExtTreeDataProvider(workspaceResourceTreeDataProvider);

    const getSubscriptions: (filter: boolean) => Promise<AzureSubscription[]> =
        async (filter: boolean) => { return await (await azureResourceTreeDataProvider.getAzureSubscriptionProvider()).getSubscriptions(filter) };

    return createApiProvider(
        [
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
        ]
    );
}

export function deactivate(): void {
    ext.diagnosticWatcher?.dispose();
}
