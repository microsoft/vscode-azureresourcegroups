/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureResource } from 'api/docs/vscode-azureresources-api';
import * as vscode from 'vscode';
import { AzExtResourceType, ResourceModelBase } from '../../../api/src/index';
import { AzureResourceProviderManager } from '../../api/ResourceProviderManagers';
import { azureExtensions } from '../../azureExtensions';
import { showHiddenTypesSettingKey } from '../../constants';
import { ext } from '../../extensionVariables';
import { settingUtils } from '../../utils/settingUtils';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { TreeItemStateStore } from '../TreeItemState';
import { AzureResourceGroupingManager } from './AzureResourceGroupingManager';
import { AzureResourceTreeDataProviderBase } from './AzureResourceTreeDataProviderBase';
import { GroupingItem } from './GroupingItem';

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
            const azureSubscriptionProvider = await this.getAzureAccountExtensionApi();
            if (azureSubscriptionProvider.status === 'LoggedIn' && azureSubscriptionProvider.filters.length > 0) {
                const showHiddenTypes = settingUtils.getWorkspaceSetting<boolean>(showHiddenTypesSettingKey);

                let resources: AzureResource[] = [];
                for await (const subscription of azureSubscriptionProvider.filters) {
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
                                .find((value) => value.resourceGroup?.id.toLowerCase() === focusedGroup.id.toLowerCase());
                            break;
                        case 'resourceType':
                            focusedGroupItem = this.resourceGroupingManager.groupResources(undefined, undefined, resources, 'resourceType')
                                .find((value) => value.resourceType === focusedGroup.type);
                            break;
                        case 'location':
                            focusedGroupItem = this.resourceGroupingManager.groupResources(undefined, undefined, resources, 'location')
                                .find((value) => value.location === focusedGroup.location);
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
