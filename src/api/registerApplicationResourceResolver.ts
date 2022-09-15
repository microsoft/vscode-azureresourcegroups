/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AppResourceResolver } from "@microsoft/vscode-azext-utils/hostapi";
import { Disposable } from "vscode";
import { ext } from "../extensionVariables";
import { CompatibleBranchDataProvider } from "./v2/compatibility/CompatibleBranchDataProvider";
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from "./v2/v2AzureResourcesApi";

export const applicationResourceResolvers: Record<string, AppResourceResolver> = {};

export function registerApplicationResourceResolver(id: string, resolver: AppResourceResolver): Disposable {
    if (applicationResourceResolvers[id]) {
        throw new Error(`Application resource resolver with id '${id}' has already been registered.`);
    }

    applicationResourceResolvers[id] = resolver;
    ext.emitters.onDidRegisterResolver.fire(resolver);

    const compat = new CompatibleBranchDataProvider(resolver, 'azureResourceGroups.loadMore' /** TODO: what is the correct value for this? */);

    ext.v2.api.registerApplicationResourceBranchDataProvider(id, compat as unknown as BranchDataProvider<ApplicationResource, ResourceModelBase>);

    return new Disposable(() => {
        delete applicationResourceResolvers[id];
    });
}
