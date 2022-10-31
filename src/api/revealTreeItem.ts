/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { revealResource } from "../commands/revealResource";

// TODO: remove this from the API, it's never called by any client extensions
export async function revealTreeItem(resource: string): Promise<void> {
    return await callWithTelemetryAndErrorHandling('api.revealTreeItem', async (context: IActionContext) => {
        await revealResource(context, resource);
    });
}
