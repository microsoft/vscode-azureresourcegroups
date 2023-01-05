/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandlingSync } from "@microsoft/vscode-azext-utils";
import { WorkspaceResourceProvider } from "@microsoft/vscode-azext-utils/hostapi";
import { Disposable } from "vscode";
import { ext } from "../extensionVariables";
import { CompatibilityWorkspaceResourceProvider } from "./v2/compatibility/workspace/CompatibilityWorkspaceResourceProvider";
import { CompatibleWorkspaceResourceBranchDataProvider } from "./v2/compatibility/workspace/CompatibleWorkspaceResourceBranchDataProvider";

export const workspaceResourceProviders: Record<string, WorkspaceResourceProvider> = {};

export function registerWorkspaceResourceProvider(resourceType: string, provider: WorkspaceResourceProvider): Disposable {
    workspaceResourceProviders[resourceType] = provider;

    return callWithTelemetryAndErrorHandlingSync('registerWorkspaceResourceProvider', () => {
        const disposables: Disposable[] = [];

        ext.actions.refreshWorkspaceTree();

        disposables.push(ext.v2.api.resources.registerWorkspaceResourceProvider(new CompatibilityWorkspaceResourceProvider(resourceType, provider)));
        disposables.push(ext.v2.api.resources.registerWorkspaceResourceBranchDataProvider(resourceType, new CompatibleWorkspaceResourceBranchDataProvider('azureWorkspace.loadMore')));

        return new Disposable(() => {
            for (const disposable of disposables) {
                disposable.dispose();
            }
            delete workspaceResourceProviders[resourceType];
            ext.actions.refreshWorkspaceTree();
        });
    }) as Disposable;
}

