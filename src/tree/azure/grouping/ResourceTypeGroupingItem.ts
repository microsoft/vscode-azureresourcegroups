/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtResourceType } from "api/src/AzExtResourceType";
import * as vscode from 'vscode';
import { getAzureExtensions } from "../../../AzExtWrapper";
import { canFocusContextValue } from "../../../constants";
import { localize } from "../../../utils/localize";
import { GenericItem } from "../../GenericItem";
import { ResourceGroupsItem } from "../../ResourceGroupsItem";
import { GroupingItem, GroupingItemOptions } from "./GroupingItem";
import { GroupingItemFactoryOptions } from "./GroupingItemFactory";

const resourceTypeGroupingItemType = 'resourceType';

export class ResourceTypeGroupingItem extends GroupingItem {
    public override readonly groupingType = resourceTypeGroupingItemType;

    constructor(public readonly resourceType: AzExtResourceType | string, options: GroupingItemOptions, factoryOptions: GroupingItemFactoryOptions) {
        super(options, factoryOptions);

        this.contextValues.push('azureResourceTypeGroup', resourceType, canFocusContextValue);
    }

    override getGenericItemsForEmptyGroup(): ResourceGroupsItem[] | undefined {
        // Find the extension for this resource type
        const extension = getAzureExtensions().find(ext =>
            ext.supportsResourceType(this.resourceType)
        );

        if (!extension || extension.isPrivate()) {
            return undefined;
        }

        // Special handling for AI Foundry - open the view in the extension if installed
        if (this.resourceType === AzExtResourceType.AiFoundry && extension.isInstalled()) {
            return [
                new GenericItem(
                    localize('openInFoundryExtension', 'Open in AI Foundry Extension'),
                    {
                        commandArgs: [],
                        commandId: 'microsoft-foundry-resources.focus',
                        contextValue: 'openInFoundryExtension',
                        iconPath: new vscode.ThemeIcon('symbol-method-arrow'),
                        id: `${this.id}/openInFoundryExtension`
                    })
            ];
        }

        // If the extension is not installed and is not private, show an "Install extension" item
        if (!extension.isInstalled()) {
            return [
                new GenericItem(
                    localize('openInExtension', 'Open in {0} Extension', extension.label),
                    {
                        commandArgs: [extension.id],
                        commandId: 'azureResourceGroups.installExtension',
                        contextValue: 'installExtension',
                        iconPath: new vscode.ThemeIcon('extensions'),
                        id: `${this.id}/installExtension`
                    })
            ];
        }

        return undefined;
    }
}

export function isResourceTypeGroupingItem(groupingItem: GroupingItem): groupingItem is ResourceTypeGroupingItem {
    return groupingItem.groupingType === resourceTypeGroupingItemType;
}
