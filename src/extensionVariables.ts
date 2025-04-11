/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import { AzExtTreeDataProvider, IAzExtLogOutputChannel, IExperimentationServiceAdapter } from "@microsoft/vscode-azext-utils";
import { AzExtResourceType } from "api/src/AzExtResourceType";
import { DiagnosticCollection, Disposable, ExtensionContext, TreeView } from "vscode";
import { TagFileSystem } from "./commands/tags/TagFileSystem";
import { AzureResourcesApiInternal } from "./hostapi.v2.internal";
import { ManagedIdentityBranchDataProvider } from "./managedIdentity/ManagedIdentityBranchDataProvider";
import { AzureResourcesServiceFactory } from "./services/AzureResourcesService";
import { TreeDataItem } from "./tree/ResourceGroupsItem";
import { TreeItemStateStore } from "./tree/TreeItemState";
import { ActivityLogTreeDataProvider } from "./tree/activityLog/ActivityLogBranchDataProvider";
import { FocusViewTreeDataProvider } from "./tree/azure/FocusViewTreeDataProvider";

export namespace extActions {
    export let refreshWorkspaceTree: (data?: TreeDataItem | TreeDataItem[] | null | undefined | void) => void;
    export let refreshAzureTree: (data?: TreeDataItem | TreeDataItem[] | null | undefined | void) => void;
    export let refreshFocusTree: (data?: TreeDataItem | TreeDataItem[] | null | undefined | void) => void;
    export let refreshTenantTree: (data?: TreeDataItem | TreeDataItem[] | null | undefined | void) => void;
    export let refreshActivityLogTree: (data?: TreeDataItem | TreeDataItem[] | null | undefined | void) => void;
}

/**
 * Namespace for common variables used throughout the extension. They must be initialized in the activate() method of extension.ts
 */
export namespace ext {
    export let context: ExtensionContext;
    // TODO: do we need this? only used by load more command
    export let appResourceTree: AzExtTreeDataProvider;
    export let appResourceTreeView: TreeView<unknown>;
    // TODO: do we need this? only used by load more command
    export let workspaceTree: AzExtTreeDataProvider;
    export let workspaceTreeView: TreeView<unknown>;
    export let tenantTreeView: TreeView<unknown>
    export let activityLogTree: ActivityLogTreeDataProvider;
    export let activityLogTreeView: TreeView<unknown>;
    export let helpTree: AzExtTreeDataProvider;
    export let outputChannel: IAzExtLogOutputChannel;
    export let ignoreBundle: boolean | undefined;
    export const prefix: string = 'azureResourceGroups';

    export let tagFS: TagFileSystem;
    export let diagnosticWatcher: Disposable | undefined;
    export let diagnosticCollection: DiagnosticCollection;

    export let azureTreeState: TreeItemStateStore;

    export let subscriptionProviderFactory: () => Promise<AzureSubscriptionProvider>;
    export let managedIdentityBranchDataProvider: ManagedIdentityBranchDataProvider;

    export namespace v2 {
        export let api: AzureResourcesApiInternal;
    }

    export namespace testing {
        export let overrideAzureServiceFactory: AzureResourcesServiceFactory | undefined;
        export let overrideAzureSubscriptionProvider: (() => AzureSubscriptionProvider) | undefined;
    }

    export let focusedGroup: GroupingKind | undefined;
    export let focusView: TreeView<unknown>;
    export let focusViewTreeDataProvider: FocusViewTreeDataProvider;

    export const actions = extActions;

    export let experimentationService: IExperimentationServiceAdapter | undefined;
}

export type ResourceTypeGrouping = {
    kind: 'resourceType';
    type: AzExtResourceType;
}

export type ResourceGroupGrouping = {
    kind: 'resourceGroup';
    id: string;
}

type LocationGrouping = {
    kind: 'location';
    location: string;
}

export type GroupingKind = ResourceTypeGrouping | ResourceGroupGrouping | LocationGrouping;
