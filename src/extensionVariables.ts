/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeDataProvider, AzExtTreeItem, IAzExtOutputChannel } from "@microsoft/vscode-azext-utils";
import { DiagnosticCollection, Disposable, Event, EventEmitter, ExtensionContext, TreeView } from "vscode";
import { ActivityLogTreeItem } from "./activityLog/ActivityLogsTreeItem";
import { TagFileSystem } from "./commands/tags/TagFileSystem";
import { AzureAccountTreeItem } from "./tree/AzureAccountTreeItem";
import { ExtensionActivationManager } from "./utils/ExtensionActivationManager";

namespace extEmitters {
    export let onDidChangeFocusedGroup: EventEmitter<void>;
}

namespace extEvents {
    export let onDidChangeFocusedGroup: Event<void>;
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
}
