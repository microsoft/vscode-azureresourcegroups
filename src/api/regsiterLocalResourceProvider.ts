/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandlingSync } from "@microsoft/vscode-azext-utils";
import { Disposable } from "vscode";
import { LocalResourceProvider } from "../api";
import { refreshWorkspace } from "../commands/workspace/refreshWorkspace";
import { ext } from "../extensionVariables";

export const localResourceProviders: Record<string, LocalResourceProvider> = {};

export function registerLocalResourceProvider(resourceType: string, provider: LocalResourceProvider): Disposable | undefined {
    return callWithTelemetryAndErrorHandlingSync('registerLocalResourceProvider', (context) => {
        localResourceProviders[resourceType] = provider;

        void ext.workspaceTree.refresh(context);

        return new Disposable(() => {
            delete localResourceProviders[resourceType];
            void refreshWorkspace(context);
        });
    });
}
