/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { ext } from "../extensionVariables";
import { AppResourceTreeItem } from "../tree/AppResourceTreeItem";

// TODO: is this ever invoked?
export async function revealTreeItem(resource: string | AppResourceTreeItem): Promise<void> {
    return await callWithTelemetryAndErrorHandling('api.revealTreeItem', async (context: IActionContext) => {
        let node: AzExtTreeItem | undefined;
        if (typeof resource === 'string') {
            node = await ext.appResourceTree.findTreeItem(resource, { ...context, loadAll: true });
        } else {
            node = resource;
        }

        if (node) {
            await ext.appResourceTreeView.reveal(node, { select: true, focus: true, expand: false });
        }
    });
}
