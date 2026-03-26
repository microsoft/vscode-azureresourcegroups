/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import type { SignInOptions } from '@microsoft/vscode-azext-azureauth';
import { ext } from '../../extensionVariables';

// eslint-disable-next-line @typescript-eslint/naming-convention
let _isLoggingIn: boolean = false;

export async function logIn(_context: IActionContext, options?: SignInOptions): Promise<void> {
    try {
        const provider = await ext.subscriptionProviderFactory();
        _isLoggingIn = true;
        ext.actions.refreshAzureTree(); // Refresh to cause the "logging in" spinner to show
        ext.actions.refreshTenantTree(); // Refresh to cause the "logging in" spinner to show
        await provider.signIn(undefined, options);
    } finally {
        _isLoggingIn = false;
        // Clear cache for each tree to ensure fresh data is fetched after sign-in
        ext.setClearCacheOnNextLoad();
        ext.actions.refreshAzureTree(); // Refresh now that sign in is complete
        ext.setClearCacheOnNextLoad();
        ext.actions.refreshTenantTree(); // Refresh now that sign in is complete
    }
}

export function isLoggingIn(): boolean {
    return _isLoggingIn;
}
