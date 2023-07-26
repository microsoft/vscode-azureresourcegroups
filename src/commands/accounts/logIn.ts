/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';

let _isLoggingIn: boolean = false;

export async function logIn(_context: IActionContext): Promise<void> {
    try {
        const provider = await ext.subscriptionProviderFactory();
        _isLoggingIn = true;
        ext.actions.refreshAzureTree(); // Refresh to cause the "logging in" spinner to show
        await provider.signIn();
    } finally {
        _isLoggingIn = false;
        ext.actions.refreshAzureTree(); // Refresh now that sign in is complete
    }
}

export function isLoggingIn(): boolean {
    return _isLoggingIn;
}
