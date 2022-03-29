/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { GenericTreeItem, ISubscriptionContext } from "@microsoft/vscode-azext-utils";
import { ThemeIcon } from "vscode";
import { AppResource, AppResourceResolver, ResolvedAppResourceBase } from "../api";
import { getAzureExtensions } from "../AzExtWrapper";
import { localize } from "../utils/localize";
import { BuiltinResolver } from "./BuiltinResolver";

/**
 * This resolver acts as a "placeholder" resolver when an extension is known for the resource type but not installed (or not enabled).
 * Upon the resolved node being clicked, it will open the extension page on the marketplace to allow them to easily install (or enable).
 */
class InstallableAppResourceResolver implements AppResourceResolver, BuiltinResolver {
    public readonly resolverKind = 'builtin';

    public resolveResource(_subContext: ISubscriptionContext, resource: AppResource): ResolvedAppResourceBase {
        // We know the extension is known but uninstalled, or else it would not have passed the `isApplicable` check below
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const extension = getAzureExtensions().find(azExt => azExt.matchesResourceType(resource))!;

        return {
            loadMoreChildrenImpl: async () => {
                const ti = new GenericTreeItem(undefined, {
                    contextValue: 'installExtension',
                    label: localize('installExtensionToEnableFeatures', 'Install extension to enable additional features...'),
                    commandId: 'azureResourceGroups.installExtension',
                    iconPath: new ThemeIcon('extensions'),
                });
                ti.commandArgs = [extension.id];

                return [ti];
            }
        };
    }

    public matchesResource(resource: AppResource): boolean {
        return getAzureExtensions().some(azExt => azExt.matchesResourceType(resource) && !azExt.isInstalled());
    }
}

export const installableAppResourceResolver = new InstallableAppResourceResolver();
