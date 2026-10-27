/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { debug, WorkspaceFolder } from "vscode";

export async function startDebugConfiguration(_context: IActionContext, folder: WorkspaceFolder, launchConfigName: string): Promise<void> {
    if (!folder || !launchConfigName) {
        return;
    }
    await debug.startDebugging(folder, launchConfigName);
}
