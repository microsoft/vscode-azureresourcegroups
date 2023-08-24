/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import { AzExtTreeDataProvider, IAzExtLogOutputChannel } from "@microsoft/vscode-azext-utils";
import { AzExtResourceType } from "api/src/AzExtResourceType";
import { DiagnosticCollection, Disposable, ExtensionContext, TreeView, UIKind, env } from "vscode";
import { ActivityLogTreeItem } from "./activityLog/ActivityLogsTreeItem";
import { TagFileSystem } from "./commands/tags/TagFileSystem";
import { AzureResourcesApiInternal } from "./hostapi.v2.internal";
import { AzureResourcesServiceFactory } from "./services/AzureResourcesService";
import { ResourceGroupsItem } from "./tree/ResourceGroupsItem";
import { TreeItemStateStore } from "./tree/TreeItemState";
import { FocusViewTreeDataProvider } from "./tree/azure/FocusViewTreeDataProvider";

export namespace extActions {
    export let refreshWorkspaceTree: (data?: ResourceGroupsItem | ResourceGroupsItem[] | null | undefined | void) => void;
    export let refreshAzureTree: (data?: ResourceGroupsItem | ResourceGroupsItem[] | null | undefined | void) => void;
    export let refreshFocusTree: (data?: ResourceGroupsItem | ResourceGroupsItem[] | null | undefined | void) => void;
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
    export let activityLogTree: AzExtTreeDataProvider;
    export let activityLogTreeItem: ActivityLogTreeItem;
    export let helpTree: AzExtTreeDataProvider;
    export let outputChannel: IAzExtLogOutputChannel;
    export let ignoreBundle: boolean | undefined;
    export const prefix: string = 'azureResourceGroups';

    export let tagFS: TagFileSystem;
    export let diagnosticWatcher: Disposable | undefined;
    export let diagnosticCollection: DiagnosticCollection;

    export let azureTreeState: TreeItemStateStore;

    export let subscriptionProviderFactory: () => Promise<AzureSubscriptionProvider>;

    // When debugging thru VS Code as a web environment, the UIKind is Desktop. However, if you sideload it into the browser, you must
    // change this to UIKind.Web and then webpack it again
    export const isWeb: boolean = env.uiKind === UIKind.Web;

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
