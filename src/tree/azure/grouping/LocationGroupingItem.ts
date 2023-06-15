/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { canFocusContextValue } from "../../../constants";
import { GroupingItem, GroupingItemOptions } from "./GroupingItem";
import { GroupingItemFactoryOptions } from "./GroupingItemFactory";

export class LocationGroupingItem extends GroupingItem {
    constructor(public readonly location: string, options: GroupingItemOptions, factoryOptions: GroupingItemFactoryOptions) {
        super(options, factoryOptions);
        this.contextValues.push('locationGroup', canFocusContextValue);
    }
}

export function isLocationGroupingItem(groupingItem: GroupingItem): groupingItem is LocationGroupingItem {
    return groupingItem instanceof LocationGroupingItem;
}
