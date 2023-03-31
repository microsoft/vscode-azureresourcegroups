/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';

export async function createAccount(_context: IActionContext): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse('https://aka.ms/VSCodeCreateAzureAccount'));
}
