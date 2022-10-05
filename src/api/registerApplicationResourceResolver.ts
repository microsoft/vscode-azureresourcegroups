/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtResourceType, AzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { AppResourceResolver } from "@microsoft/vscode-azext-utils/hostapi";
import { Disposable } from "vscode";
import { ext } from "../extensionVariables";
import { CompatibleBranchDataProvider } from "./v2/compatibility/CompatibleBranchDataProvider";
import { ApplicationResource, BranchDataProvider } from "./v2/v2AzureResourcesApi";

export const applicationResourceResolvers: Record<string, AppResourceResolver> = {};

export function registerApplicationResourceResolver(type: AzExtResourceType, resolver: AppResourceResolver): Disposable {
    if (applicationResourceResolvers[type]) {
        throw new Error(`Application resource resolver with id '${type}' has already been registered.`);
    }

    applicationResourceResolvers[type] = resolver;
    ext.emitters.onDidRegisterResolver.fire(resolver);

    const compat = new CompatibleBranchDataProvider(resolver, 'azureResourceGroups.loadMore' /** TODO: what is the correct value for this? */);

    ext.v2.api.registerApplicationResourceBranchDataProvider(type, compat as unknown as BranchDataProvider<ApplicationResource, AzExtTreeItem>);

    return new Disposable(() => {
        delete applicationResourceResolvers[type];
    });
}
