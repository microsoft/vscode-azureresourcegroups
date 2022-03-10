/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { Disposable } from "vscode";
import { AppResourceProvider } from "../api";

export const applicationResourceProviders: AppResourceProvider[] = [];

export function registerApplicationResourceProvider(provider: AppResourceProvider): Disposable {
    // not handling resource kind yet
    applicationResourceProviders.push(provider);

    return new Disposable(() => {
        applicationResourceProviders.splice(applicationResourceProviders.indexOf(provider), 1);
    });
}
