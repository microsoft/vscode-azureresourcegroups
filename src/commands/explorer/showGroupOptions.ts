/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { commands } from "vscode";

export async function showGroupOptions(): Promise<void> {
    await commands.executeCommand("workbench.view.extension.azure");
    await commands.executeCommand('workbench.action.quickOpen', '>Azure: Group by');
}
