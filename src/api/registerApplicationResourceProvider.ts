/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { Disposable } from "vscode";
import { AppResourceProvider } from "../api";

export const applicationResourceProviders: Record<string, AppResourceProvider> = {};

export function registerApplicationResourceProvider(id: string, provider: AppResourceProvider): Disposable {
    applicationResourceProviders[id] = provider;

    return new Disposable(() => {
        delete applicationResourceProviders[id];
    });
}
