/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeView } from "vscode";
import { ext } from "../extensionVariables";


export async function getSelectedAzureNode(): Promise<string | undefined> {
    const resourceTreeView = (ext.appResourceTreeView as TreeView<{ id?: string }>);
    const selectedItem = resourceTreeView.selection.at(0);
    return selectedItem?.id;
}

const maxRecentlyUsedNodes = 15;
const recentlyUsedNodes: string[] = [];

export async function getRecentlyUsedAzureNodes(): Promise<string[]> {
    return recentlyUsedNodes.slice(0);
}

function addToRecentlyUsedNodes(newNodeId: string): void {
    const removeIdx = recentlyUsedNodes.findIndex((existingId) => existingId === newNodeId);

    if (removeIdx !== -1) {
        recentlyUsedNodes.splice(removeIdx, 1);
    }

    recentlyUsedNodes.unshift(newNodeId);

    while (recentlyUsedNodes.length > maxRecentlyUsedNodes) {
        recentlyUsedNodes.pop();
    }
}

export function listenForRecentlyUsedNodes(): void {
    const resourceTreeView = (ext.appResourceTreeView as TreeView<{ id?: string }>);

    ext.context.subscriptions.push(resourceTreeView.onDidChangeSelection((e) => {
        const newSelectionId = e.selection.at(0)?.id;
        if (newSelectionId) {
            addToRecentlyUsedNodes(newSelectionId);
        }
    }));

    ext.context.subscriptions.push(resourceTreeView.onDidExpandElement((e) => {
        const expandedId = e.element.id;
        if (expandedId) {
            addToRecentlyUsedNodes(expandedId);
        }
    }));
}
