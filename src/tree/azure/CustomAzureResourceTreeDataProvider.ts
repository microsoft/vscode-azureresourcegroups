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
import { AzureSubscriptionProvider } from '../../services/SubscriptionProvider';
import { settingUtils } from '../../utils/settingUtils';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from '../ResourceTreeDataProviderBase';
import { TreeItemStateStore } from '../TreeItemState';
import { AzureResourceGroupingManager } from './AzureResourceGroupingManager';
import { GroupingItem } from './GroupingItem';

const supportedResourceTypes: AzExtResourceType[] =
    azureExtensions
        .map(e => e.resourceTypes)
        .reduce((a, b) => a.concat(...b), []);

export class CustomAzureResourceTreeDataProvider extends ResourceTreeDataProviderBase {
    private subscriptionProvider: AzureSubscriptionProvider | undefined;
    private filtersSubscription: vscode.Disposable | undefined;
    private statusSubscription: vscode.Disposable | undefined;

    constructor(
        onDidChangeBranchTreeData: vscode.Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined>,
        itemCache: BranchDataItemCache,
        state: TreeItemStateStore,
        onRefresh: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
        private readonly resourceGroupingManager: AzureResourceGroupingManager,
        private readonly resourceProviderManager: AzureResourceProviderManager) {
        super(
            itemCache,
            onDidChangeBranchTreeData,
            resourceProviderManager.onDidChangeResourceChange,
            onRefresh,
            state,
            () => {
                this.filtersSubscription?.dispose();
                this.statusSubscription?.dispose();
            });
    }

    private resources: AzureResource[] = [];

    async onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        if (element) {
            return await element.getChildren();
        } else {
            const azureSubscriptionProvider = await this.getAzureAccountExtensionApi();
            if (azureSubscriptionProvider.status === 'LoggedIn' && azureSubscriptionProvider.filters.length > 0) {
                const showHiddenTypes = settingUtils.getWorkspaceSetting<boolean>(showHiddenTypesSettingKey);

                if (this.resources.length === 0) {
                    for await (const subscription of azureSubscriptionProvider.filters) {
                        this.resources.push(...await this.resourceProviderManager.getResources(subscription));
                    }
                    if (!showHiddenTypes) {
                        this.resources = this.resources.filter(resource => resource.azureResourceType.type === 'microsoft.resources/resourcegroups' || (resource.resourceType && supportedResourceTypes.find(type => type === resource.resourceType)));
                    }
                }

                let focusedGroupItem: GroupingItem | undefined = undefined;
                const focusedGroup = ext.focusedGroup;
                if (focusedGroup) {
                    switch (focusedGroup.kind) {
                        case 'resourceGroup':
                            focusedGroupItem = this.resourceGroupingManager.groupResources(undefined, undefined, this.resources, 'resourceGroup')
                                .find((value) => value.resourceGroup?.id.toLowerCase() === focusedGroup.id.toLowerCase());
                            break;
                        case 'resourceType':
                            focusedGroupItem = this.resourceGroupingManager.groupResources(undefined, undefined, this.resources, 'resourceType')
                                .find((value) => value.resourceType === focusedGroup.type);
                            break;
                        case 'location':
                            focusedGroupItem = this.resourceGroupingManager.groupResources(undefined, undefined, this.resources, 'location')
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

    protected override isAncestorOf(element: ResourceGroupsItem, id: string): boolean {
        if (element instanceof GroupingItem) {
            return element.resources.some(resource => id.toLowerCase().startsWith(resource.id.toLowerCase()));
        }
        return super.isAncestorOf(element, id)
    }

    private async getAzureAccountExtensionApi(): Promise<AzureSubscriptionProvider> {
        // override for testing
        if (ext.testing.overrideAzureSubscriptionProvider) {
            return ext.testing.overrideAzureSubscriptionProvider();
        } else {
            if (!this.subscriptionProvider) {
                this.subscriptionProvider = await ext.subscriptionProviderFactory();
                await this.subscriptionProvider.waitForFilters();
            }

            this.filtersSubscription = this.subscriptionProvider.onFiltersChanged(() => this.notifyTreeDataChanged());
            this.statusSubscription = this.subscriptionProvider.onStatusChanged(() => this.notifyTreeDataChanged());

            return this.subscriptionProvider;
        }
    }
}
