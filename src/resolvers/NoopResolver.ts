/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { TreeItemCollapsibleState } from "vscode";
import { AppResource, AppResourceResolver, ResolvedAppResourceBase } from "../api";
import { getAzureExtensions } from "../AzExtWrapper";
import { BuiltinResolver } from "./BuiltinResolver";

/**
 * This resolver acts as a "placeholder" resolver when an extension is known for the resource type *and* installed (but not yet activated).
 * Upon the resolved node being clicked, it will reveal the resource as JSON.
 */
class NoopResolver implements AppResourceResolver, BuiltinResolver {
    public readonly resolverKind = 'builtin';

    public resolveResource(_subContext: ISubscriptionContext, _resource: AppResource): ResolvedAppResourceBase {
        return {
            collapsibleState: TreeItemCollapsibleState.None,
        };
    }

    public matchesResource(resource: AppResource): boolean {
        return getAzureExtensions().some(azExt => azExt.matchesResourceType(resource) && azExt.isInstalled());
    }
}

export const noopResolver = new NoopResolver();
