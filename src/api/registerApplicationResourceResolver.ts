/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { Disposable } from "vscode";
import { AppResourceResolver } from "../api";
import { ext } from "../extensionVariables";

export const applicationResourceResolvers: Record<string, AppResourceResolver> = {};

export function registerApplicationResourceResolver(provider: AppResourceResolver, resourceType: string, _resourceKind?: string): Disposable {
    // not handling resource kind yet
    applicationResourceResolvers[resourceType] = provider;

    void callWithTelemetryAndErrorHandling('resolveVisibleChildren', async (context: IActionContext) => {
        await ext.rootAccountTreeItem.resolveVisibleChildren(context, resourceType);
    });

    return new Disposable(() => {
        delete applicationResourceResolvers[resourceType];
    });
}
