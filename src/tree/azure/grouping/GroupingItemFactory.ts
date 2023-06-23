/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtResourceType } from "api/src/AzExtResourceType";
import type { AzureResource, AzureResourceBranchDataProvider, AzureResourceModel } from "api/src/resources/azure";
import * as vscode from 'vscode';
import type { ResourceItemFactory } from "../AzureResourceItem";
import { GroupingItem, GroupingItemDisplayOptions, GroupingItemOptions } from "./GroupingItem";
import { LocationGroupingItem } from "./LocationGroupingItem";
import { ResourceGroupGroupingItem } from "./ResourceGroupGroupingItem";
import { ResourceTypeGroupingItem } from "./ResourceTypeGroupingItem";

export interface GroupingItemFactoryOptions {
    resourceItemFactory: ResourceItemFactory<AzureResource>,
    branchDataProviderFactory: (azureResource: AzureResource) => AzureResourceBranchDataProvider<AzureResourceModel>,
    onDidChangeBranchDataProviders: vscode.Event<AzExtResourceType>,
    defaultDisplayOptions?: GroupingItemDisplayOptions,
}

export class GroupingItemFactory {
    constructor(private readonly factoryOptions: GroupingItemFactoryOptions) { }

    createGenericGroupingItem(options: GroupingItemOptions): GroupingItem {
        return new GroupingItem(options, this.factoryOptions);
    }

    createResourceGroupGroupingItem(resourceGroup: AzureResource, options: GroupingItemOptions): GroupingItem {
        return new ResourceGroupGroupingItem(resourceGroup, options, this.factoryOptions);
    }

    createResourceTypeGroupingItem(resourceType: AzExtResourceType | string, options: GroupingItemOptions): GroupingItem {
        return new ResourceTypeGroupingItem(resourceType, options, this.factoryOptions);
    }

    createLocationGroupingItem(location: string, options: GroupingItemOptions): GroupingItem {
        return new LocationGroupingItem(location, options, this.factoryOptions);
    }
}
