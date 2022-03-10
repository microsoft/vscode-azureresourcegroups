/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { AppResource, AppResourceResolver, ResolvedAppResourceBase } from "../api";
import { getAzureExtensions } from "../AzExtWrapper";

class NoopResolver implements AppResourceResolver {
    public resolveResource(_subContext: ISubscriptionContext, _resource: AppResource): ResolvedAppResourceBase {
        return {};
    }

    public isApplicable(resource: AppResource): boolean {
        return getAzureExtensions().some(azExt => azExt.matchesResourceType(resource) && azExt.isInstalled());
    }
}

export const noopResolver = new NoopResolver();
