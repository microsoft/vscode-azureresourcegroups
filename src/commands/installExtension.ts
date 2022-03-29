/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { commands } from "vscode";

export async function installExtension(_context: IActionContext, extensionId: string): Promise<void> {
    void commands.executeCommand('extension.open', extensionId);
    void commands.executeCommand('workbench.extensions.installExtension', extensionId);
}
