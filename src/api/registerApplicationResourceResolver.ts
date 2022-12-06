/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtResourceType, AzExtTreeItem, callWithTelemetryAndErrorHandlingSync } from "@microsoft/vscode-azext-utils";
import { AppResourceResolver } from "@microsoft/vscode-azext-utils/hostapi";
import { Disposable } from "vscode";
import { ext } from "../extensionVariables";
import { CompatibleApplicationResourceBranchDataProvider } from "./v2/compatibility/application/CompatibleApplicationResourceBranchDataProvider";
import { AzureResourceBranchDataProvider } from "./v2/v2AzureResourcesApi";

export const applicationResourceResolvers: Partial<Record<AzExtResourceType, AppResourceResolver>> = {};

export function registerApplicationResourceResolver(type: AzExtResourceType, resolver: AppResourceResolver): Disposable {
    return callWithTelemetryAndErrorHandlingSync('registerApplicationResourceResolver', () => {
        if (applicationResourceResolvers[type]) {
            throw new Error(`Application resource resolver with id '${type}' has already been registered.`);
        }

        applicationResourceResolvers[type] = resolver;
        ext.emitters.onDidRegisterResolver.fire(resolver);

        const compat = new CompatibleApplicationResourceBranchDataProvider(resolver, 'azureResourceGroups.loadMore' /** TODO: what is the correct value for this? */);

        const disposable = ext.v2.api.registerApplicationResourceBranchDataProvider(type, compat as unknown as AzureResourceBranchDataProvider<AzExtTreeItem>);

        return new Disposable(() => {
            delete applicationResourceResolvers[type];
            disposable.dispose();
        });
    }) as Disposable;
}
