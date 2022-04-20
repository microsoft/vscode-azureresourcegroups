/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { AppResource, AppResourceResolver, ResolvedAppResourceBase } from "@microsoft/vscode-azext-utils/hostapi";
import { getAzureExtensions } from "../AzExtWrapper";
import { ext } from "../extensionVariables";
import { BuiltinResolver } from "./BuiltinResolver";

/**
 * This resolver acts as a "placeholder" resolver when an extension is known for the resource type *and* installed (but not yet activated).
 * This returns a wrapper promise that will resolve when the resolver registers, with the value provided by that resolver
 */
class WrapperResolver implements AppResourceResolver, BuiltinResolver {
    public readonly resolverKind = 'builtin';

    public async resolveResource(subContext: ISubscriptionContext, resource: AppResource): Promise<ResolvedAppResourceBase | undefined | null> {
        return new Promise<ResolvedAppResourceBase | undefined | null>((resolve) => {
            const disposable = ext.resolverRegisteredEmitter.event((resolver: AppResourceResolver) => {
                if (resolver.matchesResource(resource)) {
                    disposable.dispose();
                    resolve(resolver.resolveResource(subContext, resource))
                } else {
                    // If it doesn't match; do nothing and also don't dispose of the event listener
                }
            });
        });
    }

    public matchesResource(resource: AppResource): boolean {
        return getAzureExtensions().some(azExt => azExt.matchesResourceType(resource) && azExt.isInstalled());
    }
}

export const wrapperResolver = new WrapperResolver();
