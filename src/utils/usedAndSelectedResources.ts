/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { TreeView } from "vscode";
import { ext } from "../extensionVariables";


export async function getSelectedAzureResource(): Promise<string | undefined> {
    const resourceTreeView = (ext.appResourceTreeView as TreeView<AzExtTreeItem>);
    const selectedItem = resourceTreeView.selection.at(0);
    return selectedItem?.id;
}

const maxRecentlyUsedResources = 15;
const recentlyUsedWithResources: string[] = [];

export async function getRecentlyUsedAzureResources(): Promise<string[]> {
    return recentlyUsedWithResources.slice(0);
}

function addToRecentlyUsedWithResources(newNodeId: string): void {
    const removeIdx = recentlyUsedWithResources.findIndex((existingId) => existingId === newNodeId);

    if (removeIdx !== -1) {
        recentlyUsedWithResources.splice(removeIdx, 1);
    }

    recentlyUsedWithResources.unshift(newNodeId);

    while (recentlyUsedWithResources.length > maxRecentlyUsedResources) {
        recentlyUsedWithResources.pop();
    }
}

export function listenForRecentlyUsedWithResources(): void {
    const resourceTreeView = (ext.appResourceTreeView as TreeView<AzExtTreeItem>);

    ext.context.subscriptions.push(resourceTreeView.onDidChangeSelection((e) => {
        const newSelectionId = e.selection.at(0)?.id;
        if (newSelectionId) {
            addToRecentlyUsedWithResources(newSelectionId);
        }
    }));

    ext.context.subscriptions.push(resourceTreeView.onDidExpandElement((e) => {
        const expandedId = e.element.id;
        if (expandedId) {
            addToRecentlyUsedWithResources(expandedId);
        }
    }));
}
