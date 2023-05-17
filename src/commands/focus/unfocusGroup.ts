/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { hasFocusedGroupContextKey } from "../../constants";
import { ext } from "../../extensionVariables";

export async function unfocusGroup(_context: IActionContext): Promise<void> {
    ext.focusedGroup = undefined;
    ext.actions.refreshFocusTree();
    await vscode.commands.executeCommand('setContext', hasFocusedGroupContextKey, false);
}
