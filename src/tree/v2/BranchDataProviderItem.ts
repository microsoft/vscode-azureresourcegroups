/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { ApplicationResourceModel, BranchDataProvider, ResourceBase, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { ResourceGroupsItem } from './ResourceGroupsItem';
import { ResourceGroupsItemCache } from './ResourceGroupsItemCache';

export type BranchDataItemOptions = {
    contextValues?: string[];
    defaultId?: string;
    defaults?: vscode.TreeItem;
    portalUrl?: vscode.Uri;
};

/**
 * Represents a branch data provider resource model as returned by a context menu command.
 */
export interface WrappedResourceModel {
    /**
     * Unwraps the resource, returning the underlying branch data provider resource model.
     */
    unwrap<T extends ResourceModelBase>(): T | undefined;
}

function appendContextValues(originalValues: string | undefined, optionsValues: string[] | undefined, extraValues: string[] | undefined): string {
    const set = new Set<string>(originalValues?.split(' ') ?? []);

    optionsValues?.forEach(value => set.add(value));
    extraValues?.forEach(value => set.add(value));

    return Array.from(set).join(' ');
}

export class BranchDataProviderItem implements ResourceGroupsItem, WrappedResourceModel {
    constructor(
        private readonly branchItem: ResourceModelBase,
        private readonly branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>,
        private readonly itemCache: ResourceGroupsItemCache,
        private readonly options?: BranchDataItemOptions) {
        itemCache.addBranchItem(this.branchItem, this);
    }

    readonly id: string = this.branchItem.id ?? this?.options?.defaultId ?? randomUUID();

    readonly portalUrl: vscode.Uri | undefined = this.options?.portalUrl;

    async getChildren(): Promise<ResourceGroupsItem[] | undefined> {
        const children = await this.branchDataProvider.getChildren(this.branchItem);

        const factory = createBranchDataItemFactory(this.itemCache);

        // NOTE: The blind case to ApplicationResourceModel is a bit awkward, but I feel like it's better than
        //       having to create specialized item types for application and workspace resources and their
        //       requisite factories.

        return children?.map(child => factory(child, this.branchDataProvider, { portalUrl: (child as ApplicationResourceModel).portalUrl }));
    }

    async getTreeItem(): Promise<vscode.TreeItem> {
        const treeItem = await this.branchDataProvider.getTreeItem(this.branchItem);

        const contextValue = appendContextValues(treeItem.contextValue, this.options?.contextValues, this.portalUrl ? ['hasPortalUrl'] : undefined);

        return {
            ...this.options?.defaults ?? {},
            ...treeItem,
            contextValue
        };
    }

    unwrap<T extends ResourceModelBase>(): T | undefined {
        return this.branchItem as T;
    }
}

export type BranchDataItemFactory = (branchItem: ResourceModelBase, branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>, options?: BranchDataItemOptions) => BranchDataProviderItem;

export function createBranchDataItemFactory(itemCache: ResourceGroupsItemCache): BranchDataItemFactory {
    return (branchItem, branchDataProvider, options) => new BranchDataProviderItem(branchItem, branchDataProvider, itemCache, options);
}
