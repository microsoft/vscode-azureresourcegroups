/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroup } from "@azure/arm-resources";
import { IActionContext, nonNullProp } from "@microsoft/vscode-azext-utils";
import { AppResource } from "@microsoft/vscode-azext-utils/hostapi";
import { ThemeIcon } from "vscode";
import { GroupBySettings } from "../commands/explorer/groupBy";
import { ungroupedId } from "../constants";
import { createAzureExtensionsGroupConfig } from "../utils/azureUtils";
import { localize } from "../utils/localize";
import { settingUtils } from "../utils/settingUtils";
import { AppResourceTreeItem } from "./AppResourceTreeItem";
import { GroupTreeItemBase } from "./GroupTreeItemBase";
import { ResourceGroupTreeItem } from "./ResourceGroupTreeItem";
import { SubscriptionTreeItem } from "./SubscriptionTreeItem";

export type GroupTreeMap = { [groupTreeId: string]: GroupTreeItemBase };
export class ResourceCache {
    private _subscriptionTreeItem: SubscriptionTreeItem;
    private _resourceGroups: ResourceGroup[];
    private _appResources: AppResourceTreeItem[];

    public constructor(sub: SubscriptionTreeItem) {
        this._subscriptionTreeItem = sub;
        this.resetCache();
    }

    private resetCache(): void {
        this._appResources = [];
        this._resourceGroups = [];
    }

    public get appResources(): AppResourceTreeItem[] {
        return this._appResources;
    }

    public set appResources(resources: AppResource[]) {
        const { addedResources, deletedResources } = this.diffProvidedResources(this._appResources, resources);
        this.deleteResourcesFromCache(this._appResources, deletedResources);
        this._appResources.push(...addedResources.map(added => AppResourceTreeItem.Create(this._subscriptionTreeItem, added)));
    }

    public set resourceGroups(resourceGroups: ResourceGroup[]) {
        const { addedResources, deletedResources } = this.diffProvidedResources(this._resourceGroups, resourceGroups);
        this.deleteResourcesFromCache(this._resourceGroups, deletedResources);
        this._resourceGroups.push(...addedResources);
    }

    public getTreeMap(context: IActionContext, groupBySetting?: string): GroupTreeMap {
        const treeMap: GroupTreeMap = {};
        const getResourceGroupTask: (resourceGroup: string) => Promise<ResourceGroup | undefined> = async (resourceGroup: string) => {
            return this._resourceGroups.find((rg) => rg.name === resourceGroup);
        };

        const ungroupedTreeItem = new GroupTreeItemBase(this._subscriptionTreeItem, {
            label: localize('ungrouped', 'ungrouped'),
            id: `${this._subscriptionTreeItem.id}/${ungroupedId}`,
            iconPath: new ThemeIcon('json')
        });

        treeMap[ungroupedTreeItem.id] = ungroupedTreeItem;
        groupBySetting ||= <string>settingUtils.getWorkspaceSetting<string>('groupBy');
        for (const rgTree of this._appResources) {
            (<AppResourceTreeItem>rgTree).mapSubGroupConfigTree(context, groupBySetting, treeMap, getResourceGroupTask);
        }

        switch (groupBySetting) {
            case GroupBySettings.ResourceGroup:
                // if this isn't resolved by now, we need it to be so that we can retrieve empty RGs
                // only get RGs that are not in the treeMap already
                const emptyResourceGroups = this._resourceGroups.filter(rg => !treeMap[rg.id?.toLowerCase() ?? '']);
                for (const eRg of emptyResourceGroups) {
                    treeMap[nonNullProp(eRg, 'id').toLowerCase()] = ResourceGroupTreeItem.createFromResourceGroup(this._subscriptionTreeItem, eRg);
                }
                break;
            case GroupBySettings.ResourceType:
                // always create the groups for extensions that we support
                const azExtGroupConfigs = createAzureExtensionsGroupConfig(nonNullProp(this._subscriptionTreeItem, 'id'));
                for (const azExtGroupConfig of azExtGroupConfigs) {
                    if (!treeMap[azExtGroupConfig.id]) {
                        const groupTreeItem = new GroupTreeItemBase(this._subscriptionTreeItem, azExtGroupConfig);
                        treeMap[groupTreeItem.id] = groupTreeItem;
                    }
                }

                // delete groups that aren't supported by Azure extensions
                if (!settingUtils.getWorkspaceSetting('showHiddenTypes')) {
                    for (const id in treeMap) {
                        if (!azExtGroupConfigs.some(config => config.id === id)) {
                            delete treeMap[id];
                        }
                    }
                }
                break;
        }

        if (!ungroupedTreeItem.hasChildren()) {
            delete treeMap[ungroupedTreeItem.id];
        }

        return treeMap;
    }
    /**
     *
     * @param cachedResources Resources already in cache.
     * @param providedResources Resources provided by resolver/API.
     * @return Object containing arrays of added and deleted resources.
     */
    private diffProvidedResources<T extends { id?: string }>(cachedResources: T[], providedResources: T[]): { addedResources: T[], deletedResources: T[] } {
        const addedResources = providedResources.filter(providedResource => !cachedResources.some(rg => rg.id === providedResource.id));
        const deletedResources = cachedResources.filter(cachedResource => !providedResources.some(rg => rg.id === cachedResource.id));

        return { addedResources, deletedResources }
    }

    private deleteResourcesFromCache<T extends { id?: string }>(cachedResources: T[], resourcesToDelete: T[]): void {
        for (const deleted of resourcesToDelete) {
            const index = cachedResources.findIndex(cachedResource => cachedResource.id === deleted.id);
            cachedResources.splice(index, 1);
        }
    }
}
