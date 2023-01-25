/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isAzExtTreeItem } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { AzureResourceModel, BranchDataProvider, ResourceBase, ResourceModelBase, ViewPropertiesModel, Wrapper } from '../../api/src/index';
import { BranchDataItemCache } from './BranchDataItemCache';
import { ResourceGroupsItem } from './ResourceGroupsItem';

export type BranchDataItemOptions = {
    contextValues?: string[];
    defaultId?: string;
    defaults?: vscode.TreeItem;
    portalUrl?: vscode.Uri;
    viewProperties?: ViewPropertiesModel;
};

function appendContextValues(originalValues: string | undefined, optionsValues: string[] | undefined, extraValues: string[] | undefined): string {
    const set = new Set<string>(originalValues?.split(';') ?? []);

    optionsValues?.forEach(value => set.add(value));
    extraValues?.forEach(value => set.add(value));

    return Array.from(set).join(';');
}

export class BranchDataItemWrapper implements ResourceGroupsItem, Wrapper {
    constructor(
        private readonly branchItem: ResourceModelBase,
        private readonly branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>,
        private readonly itemCache: BranchDataItemCache,
        private readonly options?: BranchDataItemOptions) {
        itemCache.addBranchItem(this.branchItem, this);

        // Use AzExtTreeItem.fullId as id for compatibility.
        if (isAzExtTreeItem(this.branchItem)) {
            this.id = this.branchItem.fullId;
        } else {
            this.id = this.branchItem.id ?? this?.options?.defaultId ?? randomUUID();
        }
    }

    public readonly id: string;

    readonly portalUrl: vscode.Uri | undefined = this.options?.portalUrl;
    readonly viewProperties?: ViewPropertiesModel = this.options?.viewProperties;

    async getChildren(): Promise<ResourceGroupsItem[] | undefined> {
        const children = await this.branchDataProvider.getChildren(this.branchItem);

        const factory = createBranchDataItemFactory(this.itemCache);

        // NOTE: The blind case to AzureResourceModel is a bit awkward, but I feel like it's better than
        //       having to create specialized item types for Azure and workspace resources and their
        //       requisite factories.

        return children?.map(child =>
            factory(child, this.branchDataProvider, {
                portalUrl: (child as AzureResourceModel).portalUrl,
                viewProperties: (child as AzureResourceModel).viewProperties,
            })
        );
    }

    async getTreeItem(): Promise<vscode.TreeItem> {
        const treeItem = await this.branchDataProvider.getTreeItem(this.branchItem);

        const contextValue = appendContextValues(treeItem.contextValue, this.options?.contextValues, this.getExtraContextValues());

        return {
            ...this.options?.defaults ?? {},
            ...treeItem,
            contextValue
        };
    }

    async getParent(): Promise<ResourceGroupsItem | undefined> {
        if (this.branchDataProvider.getParent) {
            const branchItem = await this.branchDataProvider.getParent(this.branchItem);
            if (branchItem) {
                return this.itemCache.getItemForBranchItem(branchItem);
            }
        }

        return undefined;
    }

    unwrap<T>(): T {
        return this.branchItem as T;
    }

    protected getExtraContextValues(): string[] {
        const extraValues: string[] = [];
        if (this.portalUrl) {
            extraValues.push('hasPortalUrl');
        }
        if (this.viewProperties) {
            extraValues.push('hasProperties');
        }
        return extraValues;
    }
}

export type BranchDataItemFactory = (branchItem: ResourceModelBase, branchDataProvider: BranchDataProvider<ResourceBase, ResourceModelBase>, options?: BranchDataItemOptions) => BranchDataItemWrapper;

export function createBranchDataItemFactory(itemCache: BranchDataItemCache): BranchDataItemFactory {
    return (branchItem, branchDataProvider, options) => new BranchDataItemWrapper(branchItem, branchDataProvider, itemCache, options);
}
