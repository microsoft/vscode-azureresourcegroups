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
        ext.actions.refreshAzureTree();
        await provider.signIn();
        ext.actions.refreshAzureTree();
    } finally {
        _isLoggingIn = false;
    }
}

export function isLoggingIn(): boolean {
    return _isLoggingIn;
}
