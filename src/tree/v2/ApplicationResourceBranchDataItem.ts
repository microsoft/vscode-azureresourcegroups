/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { ApplicationResource, BranchDataProvider, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { BranchDataItemOptions, BranchDataProviderItem } from './BranchDataProviderItem';
import { ResourceGroupsItemCache } from "./ResourceGroupsItemCache";

export interface ApplicationResourceModel extends ResourceModelBase {
    readonly resource: ApplicationResource;
}

export class ApplicationResourceBranchDataItem extends BranchDataProviderItem {

    constructor(
        protected readonly branchItem: ApplicationResourceModel,
        branchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>,
        itemCache: ResourceGroupsItemCache,
        options: BranchDataItemOptions | undefined) {
        super(branchItem, branchDataProvider, itemCache, options);
    }

    /** Needed for tree item picker PickAppResourceStep */
    public get resource(): ApplicationResource | undefined {
        return this.branchItem.resource;
    }
}

export type ApplicationResourceBranchDataItemFactory = (branchItem: ApplicationResourceModel, branchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>, options?: BranchDataItemOptions) => ApplicationResourceBranchDataItem;

export function createApplicationResourceBranchDataItemFactory(itemCache: ResourceGroupsItemCache): ApplicationResourceBranchDataItemFactory {
    return (branchItem, branchDataProvider, options) => new ApplicationResourceBranchDataItem(branchItem, branchDataProvider, itemCache, options);
}
