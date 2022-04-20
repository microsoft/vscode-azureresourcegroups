/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandlingSync } from "@microsoft/vscode-azext-utils";
import { WorkspaceResourceProvider } from "@microsoft/vscode-azext-utils/rgapi";
import { Disposable } from "vscode";
import { refreshWorkspace } from "../commands/workspace/refreshWorkspace";

export const workspaceResourceProviders: Record<string, WorkspaceResourceProvider> = {};

export function registerWorkspaceResourceProvider(resourceType: string, provider: WorkspaceResourceProvider): Disposable {
    workspaceResourceProviders[resourceType] = provider;

    return callWithTelemetryAndErrorHandlingSync('registerWorkspaceResourceProvider', (context) => {

        void refreshWorkspace(context);

        return new Disposable(() => {
            delete workspaceResourceProviders[resourceType];
            void refreshWorkspace(context);
        });
    }) as Disposable;
}
