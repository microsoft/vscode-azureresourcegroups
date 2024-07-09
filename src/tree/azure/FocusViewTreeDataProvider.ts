/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import * as vscode from 'vscode';
import { AzExtResourceType, AzureResource, ResourceModelBase } from '../../../api/src/index';
import { AzureResourceProviderManager } from '../../api/ResourceProviderManagers';
import { azureExtensions } from '../../azureExtensions';
import { showHiddenTypesSettingKey } from '../../constants';
import { ext } from '../../extensionVariables';
import { settingUtils } from '../../utils/settingUtils';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { getAzureSubscriptionProvider } from '../OnGetChildrenBase';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { TreeItemStateStore } from '../TreeItemState';
import { AzureResourceTreeDataProviderBase } from './AzureResourceTreeDataProviderBase';
import { AzureResourceGroupingManager } from './grouping/AzureResourceGroupingManager';
import { GroupingItem } from './grouping/GroupingItem';
import { LocationGroupingItem } from './grouping/LocationGroupingItem';
import { ResourceGroupGroupingItem } from './grouping/ResourceGroupGroupingItem';
import { ResourceTypeGroupingItem } from './grouping/ResourceTypeGroupingItem';

const supportedResourceTypes: AzExtResourceType[] =
    azureExtensions
        .map(e => e.resourceTypes)
        .reduce((a, b) => a.concat(...b), []);

export class FocusViewTreeDataProvider extends AzureResourceTreeDataProviderBase {

    constructor(
        onDidChangeBranchTreeData: vscode.Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined>,
        itemCache: BranchDataItemCache,
        state: TreeItemStateStore,
        onRefresh: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
        protected readonly resourceGroupingManager: AzureResourceGroupingManager,
        protected readonly resourceProviderManager: AzureResourceProviderManager) {
        super(
            itemCache,
            onDidChangeBranchTreeData,
            onRefresh,
            state,
            resourceGroupingManager,
            resourceProviderManager);
    }

    async onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        if (element) {
            return await element.getChildren();
        } else {
            const focusedGroup = ext.focusedGroup;
            if (!focusedGroup) {
                return [];
            }

            const provider = await getAzureSubscriptionProvider(this);
            let subscriptions: AzureSubscription[] | undefined;
            if (await provider.isSignedIn() && (subscriptions = await provider.getSubscriptions(true)).length > 0) {
                const showHiddenTypes = settingUtils.getWorkspaceSetting<boolean>(showHiddenTypesSettingKey);

                let resources: AzureResource[] = [];
                for await (const subscription of subscriptions) {
                    resources.push(...await this.resourceProviderManager.getResources(subscription));
                }
                if (!showHiddenTypes) {
                    resources = resources.filter(resource => resource.azureResourceType.type === 'microsoft.resources/resourcegroups' || (resource.resourceType && supportedResourceTypes.find(type => type === resource.resourceType)));
                }

                let focusedGroupItem: GroupingItem | undefined = undefined;
                if (focusedGroup) {
                    switch (focusedGroup.kind) {
                        case 'resourceGroup':
                            focusedGroupItem = this.resourceGroupingManager.groupResources(undefined, undefined, resources, 'resourceGroup')
                                .find((value) => (value as ResourceGroupGroupingItem).resourceGroup.id.toLowerCase() === focusedGroup.id.toLowerCase());
                            break;
                        case 'resourceType':
                            focusedGroupItem = this.resourceGroupingManager.groupResources(undefined, undefined, resources, 'resourceType')
                                .find((value) => (value as ResourceTypeGroupingItem).resourceType === focusedGroup.type);
                            break;
                        case 'location':
                            focusedGroupItem = this.resourceGroupingManager.groupResources(undefined, undefined, resources, 'location')
                                .find((value) => (value as LocationGroupingItem).location === focusedGroup.location);
                            break;
                    }
                }

                return focusedGroupItem ? [focusedGroupItem] : [];
            } else {
                return [];
            }
        }
    }
}
