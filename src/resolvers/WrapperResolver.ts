/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { AppResource, AppResourceResolver, ResolvedAppResourceBase } from "../api";
import { getAzureExtensions } from "../AzExtWrapper";
import { ext } from "../extensionVariables";
import { BuiltinResolver } from "./BuiltinResolver";

/**
 * This resolver acts as a "placeholder" resolver when an extension is known for the resource type *and* installed (but not yet activated).
 * Upon the resolved node being clicked, it will reveal the resource as JSON.
 */
class WrapperResolver implements AppResourceResolver, BuiltinResolver {
    public readonly resolverKind = 'builtin';

    public async resolveResource(subContext: ISubscriptionContext, resource: AppResource): Promise<ResolvedAppResourceBase> {
        return new Promise<ResolvedAppResourceBase>((resolve) => {
            const disposable = ext.resolverRegisteredEmitter.event((resolver: AppResourceResolver) => {
                disposable.dispose();

                if (resolver.matchesResource(resource)) {
                    resolve(resolver.resolveResource(subContext, resource))
                }
            });
        });
    }

    public matchesResource(resource: AppResource): boolean {
        return getAzureExtensions().some(azExt => azExt.matchesResourceType(resource) && azExt.isInstalled());
    }
}

export const wrapperResolver = new WrapperResolver();
