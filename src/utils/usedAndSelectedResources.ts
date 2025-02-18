/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from "../extensionVariables";

function nodeHasIdAndMaybeResource(node: unknown): node is { id: string, resource?: { kind?: string } } {
    // Make sure node is a not-null object
    return typeof node === "object" && node !== null &&
        (
            // Make sure node has an id property that is a string
            typeof (node as { id: string }).id === "string"
        ) &&
        (
            // Make sure node.resource is undefined or a not-null object
            (node as { resource?: unknown }).resource === undefined ||
            (typeof (node as { resource: unknown }).resource === "object" && (node as { resource: unknown }).resource !== null)
        ) &&
        (
            // Make sure node.resource.kind is undefined or a string
            (node as { resource: { kind?: string } }).resource?.kind === undefined ||
            typeof (node as { resource: { kind?: string } }).resource?.kind === "string"
        );
}

function getArmIdAndMaybeKindFromTreeNode(node: unknown | undefined): { id: string, kind?: string } | undefined {
    if (node && nodeHasIdAndMaybeResource(node)) {
        const resourceIdParts = node.id.split("/");
        const subscriptionsIdx = resourceIdParts.indexOf("subscriptions");
        const resourceGroupsIdx = resourceIdParts.indexOf("resourceGroups");
        const providersIdx = resourceIdParts.indexOf("providers");
        if (subscriptionsIdx === resourceIdParts.length - 8 && resourceGroupsIdx === resourceIdParts.length - 6 && providersIdx === resourceIdParts.length - 4) {
            const resourceId = resourceIdParts.slice(-8).join("/");
            const kind = node.resource?.kind;
            return { id: resourceId, kind: kind };
        }
    }
    return undefined;
}


export async function getSelectedAzureResource(): Promise<{ id: string, kind?: string } | undefined> {
    return getArmIdAndMaybeKindFromTreeNode(ext.appResourceTreeView.selection.at(0));
}

const maxRecentlyUsedResources = 10;
const recentlyUsedWithResources: { id: string, kind?: string }[] = [];

export async function getRecentlyUsedAzureResources(): Promise<{ id: string, kind?: string }[]> {
    return recentlyUsedWithResources.slice(0);
}

function addToRecentlyUsedWithResources(newResource: { id: string, kind?: string }): void {
    const removeIdx = recentlyUsedWithResources.findIndex((r) => r.id === newResource.id);

    if (removeIdx !== -1) {
        recentlyUsedWithResources.splice(removeIdx, 1);
    }

    recentlyUsedWithResources.unshift({ id: newResource.id, kind: newResource.kind });

    while (recentlyUsedWithResources.length > maxRecentlyUsedResources) {
        recentlyUsedWithResources.pop();
    }
}

export async function listenForRecentlyUsedWithResources(): Promise<void> {
    const resourceTreeView = ext.appResourceTreeView;

    ext.context.subscriptions.push(resourceTreeView.onDidChangeSelection((e) => {
        const newSelectionIdAndMaybeKind = getArmIdAndMaybeKindFromTreeNode(e.selection.at(0));
        if (newSelectionIdAndMaybeKind) {
            addToRecentlyUsedWithResources(newSelectionIdAndMaybeKind);
        }
    }));

    ext.context.subscriptions.push(resourceTreeView.onDidExpandElement((e) => {
        const newSelectionIdAndMaybeKind = getArmIdAndMaybeKindFromTreeNode(e.element);
        if (newSelectionIdAndMaybeKind) {
            addToRecentlyUsedWithResources(newSelectionIdAndMaybeKind);
        }
    }));
}
