/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { ISubscriptionContext, createSubscriptionContext } from "@microsoft/vscode-azext-utils";
import { AzExtResourceType } from "api/src/AzExtResourceType";
import { AzureResource, AzureSubscription, ViewPropertiesModel } from "api/src/resources/azure";
import * as vscode from 'vscode';
import { azureExtensions } from "../../../azureExtensions";
import { ITagsModel, ResourceTags } from "../../../commands/tags/TagFileSystem";
import { canFocusContextValue, showHiddenTypesSettingKey } from "../../../constants";
import { settingUtils } from "../../../utils/settingUtils";
import { createPortalUrl } from "../../../utils/v2/createPortalUrl";
import { getAccountAndTenantPrefix } from "../idPrefix";
import { GroupingItem, GroupingItemOptions } from "./GroupingItem";
import { GroupingItemFactoryOptions } from "./GroupingItemFactory";

export class ResourceGroupGroupingItem extends GroupingItem {
    readonly id: string;
    readonly viewProperties: ViewPropertiesModel;
    readonly tagsModel: ITagsModel;
    readonly portalUrl: vscode.Uri;
    readonly subscription: ISubscriptionContext & AzureSubscription;

    constructor(readonly resourceGroup: AzureResource, options: GroupingItemOptions, factoryOptions: GroupingItemFactoryOptions) {
        super(options, factoryOptions);

        this.portalUrl = createPortalUrl(resourceGroup.subscription, resourceGroup.id);
        this.viewProperties = {
            label: resourceGroup.name,
            data: resourceGroup.raw
        };
        this.subscription = {
            // for v1.5 compatibility
            ...this.resourceGroup.subscription,
            ...createSubscriptionContext(resourceGroup.subscription),
        };
        this.id = `${getAccountAndTenantPrefix(this.subscription)}${resourceGroup.id}`;
        this.tagsModel = new ResourceTags(resourceGroup);
        this.contextValues.push('hasPortalUrl', 'azureResourceGroup', canFocusContextValue);
    }

    override getResourcesToDisplay(resources: AzureResource[]): AzureResource[] {
        const showHiddenTypes = settingUtils.getWorkspaceSetting<boolean>(showHiddenTypesSettingKey);
        if (showHiddenTypes) {
            return resources;
        }

        const supportedResourceTypes: AzExtResourceType[] =
            azureExtensions
                .map(e => e.resourceTypes)
                .reduce((a, b) => a.concat(...b), []);

        return resources.filter(resource => resource.resourceType && supportedResourceTypes.find(type => type === resource.resourceType));
    }
}

export function isResourceGroupGroupingItem(groupingItem?: GroupingItem): groupingItem is ResourceGroupGroupingItem {
    return groupingItem instanceof ResourceGroupGroupingItem;
}
