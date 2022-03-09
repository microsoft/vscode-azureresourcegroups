/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { Disposable } from "vscode";
import { AppResourceResolver } from "../api";

export const applicationResourceResolvers: Record<string, AppResourceResolver> = {};

export function registerApplicationResourceResolver(provider: AppResourceResolver, resourceType: string, _resourceKind?: string): Disposable {
    // not handling resource kind yet
    applicationResourceResolvers[resourceType] = provider;

    return new Disposable(() => {
        delete applicationResourceResolvers[resourceType];
    })
}
