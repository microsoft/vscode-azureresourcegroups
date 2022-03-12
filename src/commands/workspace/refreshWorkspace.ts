/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ext } from "../../extensionVariables";

export async function refreshWorkspace(context: IActionContext): Promise<void> {
    await ext.workspaceTree.refresh(context);
}
