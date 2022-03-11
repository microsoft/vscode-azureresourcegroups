/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { Disposable } from "vscode";
import { LocalResourceProvider } from "../api";

export const localResourceProviders: Record<string, LocalResourceProvider> = {};

export function registerApplicationResourceResolver(resourceType: string, provider: LocalResourceProvider): Disposable {
    // not handling resource kind yet
    localResourceProviders[resourceType] = provider;

    return new Disposable(() => {
        delete localResourceProviders[resourceType];
    })
}
