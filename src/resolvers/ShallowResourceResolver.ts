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
 * This resolver acts as a "placeholder" resolver when no extension is known for the resource type.
 * It changes nothing about the node. When the extension activates, it will supply the real resolver.
 */
class ShallowResourceResolver implements AppResourceResolver, BuiltinResolver {
    public readonly resolverKind = 'builtin';

    public resolveResource(_subContext: ISubscriptionContext, _resource: AppResource): ResolvedAppResourceBase {
        return {
            commandId: 'azureResourceGroups.viewProperties',
            collapsibleState: TreeItemCollapsibleState.None
        };
    }

    public matchesResource(resource: AppResource): boolean {
        return !getAzureExtensions().some(azExt => azExt.matchesResourceType(resource));
    }
}

export const shallowResourceResolver = new ShallowResourceResolver();

