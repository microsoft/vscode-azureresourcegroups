/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { AppResourceResolver } from "@microsoft/vscode-azext-utils/hostapi";
import { Disposable } from "vscode";
import { ext } from "../extensionVariables";

export const applicationResourceResolvers: Record<string, AppResourceResolver> = {};

export function registerApplicationResourceResolver(id: string, resolver: AppResourceResolver): Disposable {
    if (applicationResourceResolvers[id]) {
        throw new Error(`Application resource resolver with id '${id}' has already been registered.`);
    }

    applicationResourceResolvers[id] = resolver;

    void callWithTelemetryAndErrorHandling('resolveVisibleChildren', async (context: IActionContext) => {
        await ext.rootAccountTreeItem.resolveVisibleChildren(context, resolver);
    });

    return new Disposable(() => {
        delete applicationResourceResolvers[id];
    });
}
