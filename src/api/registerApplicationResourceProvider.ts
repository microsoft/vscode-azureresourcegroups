/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AppResourceProvider } from "@microsoft/vscode-azext-utils/rgapi";
import { Disposable } from "vscode";

export const applicationResourceProviders: Record<string, AppResourceProvider> = {};

export function registerApplicationResourceProvider(id: string, provider: AppResourceProvider): Disposable {
    if (applicationResourceProviders[id]) {
        throw new Error(`Application resource provider with id '${id}' has already been registered.`);
    }

    applicationResourceProviders[id] = provider;

    return new Disposable(() => {
        delete applicationResourceProviders[id];
    });
}
