/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';

export async function logIn(_context: IActionContext): Promise<void> {
    const provider = await ext.subscriptionProviderFactory();
    await provider.logIn();
}
