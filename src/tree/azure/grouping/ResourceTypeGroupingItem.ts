/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtResourceType } from "api/src/AzExtResourceType";
import { canFocusContextValue } from "../../../constants";
import { GroupingItem, GroupingItemOptions } from "./GroupingItem";
import { GroupingItemFactoryOptions } from "./GroupingItemFactory";

export class ResourceTypeGroupingItem extends GroupingItem {
    constructor(public readonly resourceType: AzExtResourceType | string, options: GroupingItemOptions, factoryOptions: GroupingItemFactoryOptions) {
        super(options, factoryOptions);

        this.contextValues.push('azureResourceTypeGroup', resourceType, canFocusContextValue);
    }
}

export function isResourceTypeGroupingItem(groupingItem: GroupingItem): groupingItem is ResourceTypeGroupingItem {
    return groupingItem instanceof ResourceTypeGroupingItem;
}
