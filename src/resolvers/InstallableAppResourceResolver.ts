/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { AppResource, AppResourceResolver, ResolvedAppResourceBase } from "../api";
import { getAzureExtensions } from "../AzExtWrapper";

/**
 * This resolver acts as a "placeholder" resolver when an extension is known for the resource type but not installed (or not enabled).
 * Upon the resolved node being clicked, it will open the extension page on the marketplace to allow them to easily install (or enable).
 */
class InstallableAppResourceResolver implements AppResourceResolver {
    public resolveResource(_subContext: ISubscriptionContext, resource: AppResource): ResolvedAppResourceBase {
        // We know the extension is known but uninstalled, or else it would not have passed the `isApplicable` check below
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const extensionId = getAzureExtensions().find(azExt => azExt.matchesResourceType(resource))!.id;

        return {
            commandId: 'extension.open',
            commandArgs: [extensionId],
        };
    }

    public isApplicable(resource: AppResource): boolean {
        return getAzureExtensions().some(azExt => azExt.matchesResourceType(resource) && !azExt.isInstalled());
    }
}

export const installableAppResourceResolver = new InstallableAppResourceResolver();
