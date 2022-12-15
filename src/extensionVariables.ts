/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeDataProvider, AzExtTreeItem, IAzExtOutputChannel } from "@microsoft/vscode-azext-utils";
import { AppResourceResolver } from "@microsoft/vscode-azext-utils/hostapi";
import { DiagnosticCollection, Disposable, Event, EventEmitter, ExtensionContext, TreeView } from "vscode";
import { AzureResourcesApiInternal } from "../hostapi.v2.internal";
import { ActivityLogTreeItem } from "./activityLog/ActivityLogsTreeItem";
import { TagFileSystem } from "./commands/tags/TagFileSystem";
import { AzureAccountTreeItem } from "./tree/AzureAccountTreeItem";
import { ExtensionActivationManager } from "./utils/ExtensionActivationManager";

namespace extEmitters {
    export let onDidChangeFocusedGroup: EventEmitter<void>;
    export let onDidRegisterResolver: EventEmitter<AppResourceResolver>;
}

namespace extEvents {
    export let onDidChangeFocusedGroup: Event<void>;
    export let onDidRegisterResolver: Event<AppResourceResolver>;
}

export namespace extActions {
    export let refreshWorkspaceTree: () => void;
    export let refreshAzureTree: () => void;
}

/**
 * Namespace for common variables used throughout the extension. They must be initialized in the activate() method of extension.ts
 */
export namespace ext {
    export let context: ExtensionContext;
    export let appResourceTree: AzExtTreeDataProvider;
    export let appResourceTreeView: TreeView<AzExtTreeItem>;
    export let workspaceTree: AzExtTreeDataProvider;
    export let workspaceTreeView: TreeView<AzExtTreeItem>;
    export let activityLogTree: AzExtTreeDataProvider;
    export let activityLogTreeItem: ActivityLogTreeItem;
    export let rootAccountTreeItem: AzureAccountTreeItem;
    export let helpTree: AzExtTreeDataProvider;
    export let outputChannel: IAzExtOutputChannel;
    export let ignoreBundle: boolean | undefined;
    export const prefix: string = 'azureResourceGroups';

    export let tagFS: TagFileSystem;
    export let diagnosticWatcher: Disposable | undefined;
    export let diagnosticCollection: DiagnosticCollection;

    export let activationManager: ExtensionActivationManager;

    export const emitters = extEmitters;
    export const events = extEvents;

    export namespace v2 {
        export let api: AzureResourcesApiInternal;
    }

    export const actions = extActions;
}
