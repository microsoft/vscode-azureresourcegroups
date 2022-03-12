/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeDataProvider, IAzExtOutputChannel } from "@microsoft/vscode-azext-utils";
import { DiagnosticCollection, Disposable, ExtensionContext } from "vscode";
import { AppResourceProvider } from "./api";
import { TagFileSystem } from "./commands/tags/TagFileSystem";
import { ExtensionActivationManager } from "./utils/ExtensionActivationManager";

/**
 * Namespace for common variables used throughout the extension. They must be initialized in the activate() method of extension.ts
 */
export namespace ext {
    export let context: ExtensionContext;
    export let tree: AzExtTreeDataProvider;
    export let workspaceTree: AzExtTreeDataProvider;
    export let helpTree: AzExtTreeDataProvider;
    export let outputChannel: IAzExtOutputChannel;
    export let ignoreBundle: boolean | undefined;
    export const prefix: string = 'azureResourceGroups';

    export let tagFS: TagFileSystem;
    export let diagnosticWatcher: Disposable | undefined;
    export let diagnosticCollection: DiagnosticCollection;

    export let activationManager: ExtensionActivationManager;
    export const resourceProviders: { [key: string]: AppResourceProvider } = {};
    export const groupByKeys: { [key: string]: string } = {
        resourceType: 'Resource Types',
        resourceGroup: 'Resource Groups'
    }
}
