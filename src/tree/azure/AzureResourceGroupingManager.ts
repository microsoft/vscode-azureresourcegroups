/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { nonNullValue } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AzExtResourceType, AzureResource } from '../../../api/src/index';
import { azureExtensions } from '../../azureExtensions';
import { GroupBySettings } from '../../commands/explorer/groupBy';
import { showHiddenTypesSettingKey } from '../../constants';
import { ext } from '../../extensionVariables';
import { getIconPath, getName } from '../../utils/azureUtils';
import { localize } from "../../utils/localize";
import { settingUtils } from '../../utils/settingUtils';
import { treeUtils } from '../../utils/treeUtils';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceGroupsTreeContext } from '../ResourceGroupsTreeContext';
import { GroupingItem } from './grouping/GroupingItem';
import { GroupingItemFactory } from './grouping/GroupingItemFactory';

const unknownLabel = localize('unknown', 'Unknown');

export class AzureResourceGroupingManager extends vscode.Disposable {
    private readonly onDidChangeGroupingEmitter = new vscode.EventEmitter<void>();
    private readonly configSubscription: vscode.Disposable;

    constructor(
        private readonly groupingItemFactory: GroupingItemFactory) {
        super(
            () => {
                this.configSubscription.dispose();
            });

        this.configSubscription = vscode.workspace.onDidChangeConfiguration(
            e => {
                if (e.affectsConfiguration(`${ext.prefix}.groupBy`)) {
                    this.onDidChangeGroupingEmitter.fire();
                }
            });
    }

    get onDidChangeGrouping(): vscode.Event<void> {
        return this.onDidChangeGroupingEmitter.event;
    }

    groupResources(parent: ResourceGroupsItem | undefined, context: ResourceGroupsTreeContext | undefined, resources: AzureResource[], groupBySetting?: string): GroupingItem[] {
        if (groupBySetting?.startsWith('armTag')) {
            const tag = groupBySetting.substring('armTag'.length + 1);

            return this.groupByArmTag(parent, context, resources, tag);
        }

        switch (groupBySetting) {
            case GroupBySettings.Location:

                return this.groupByLocation(parent, context, resources);

            case GroupBySettings.ResourceType:

                return this.groupByResourceType(parent, context, resources);

            case GroupBySettings.ResourceGroup:
            default:

                return this.groupByResourceGroup(parent, context, resources);
        }
    }

    private groupBy(allResources: AzureResource[], keySelector: (resource: AzureResource) => string, initialGrouping: { [key: string]: AzureResource[] } | undefined, groupingItemFactory: (key: string, resourcesForKey: AzureResource[]) => GroupingItem) {
        initialGrouping = initialGrouping ?? {};

        const map = allResources.reduce(
            (acc, resource) => {
                const key = keySelector(resource);
                let children = acc[key];

                if (!children) {
                    acc[key] = children = [];
                }

                children.push(resource);

                return acc;
            },
            initialGrouping);

        return Object.entries(map).map(([key, resources]) => groupingItemFactory(key, resources));
    }

    private groupByArmTag(parent: ResourceGroupsItem | undefined, context: ResourceGroupsTreeContext | undefined, allResources: AzureResource[], tag: string): GroupingItem[] {
        const ungroupedKey = 'ungrouped';

        const keySelector = (resource: AzureResource) => resource.tags?.[tag] ?? ungroupedKey;

        return this.groupBy(
            allResources,
            keySelector,
            undefined,
            (tag, resources): GroupingItem => this.groupingItemFactory.createGenericGroupingItem({
                parent,
                context,
                resources,
                iconPath: new vscode.ThemeIcon(tag !== ungroupedKey ? 'tag' : 'json'),
                label: tag !== ungroupedKey ? tag : localize('ungrouped', 'ungrouped'),
            })
        );
    }

    private groupByLocation(parent: ResourceGroupsItem | undefined, context: ResourceGroupsTreeContext | undefined, allResources: AzureResource[]): GroupingItem[] {
        return this.groupBy(
            allResources,
            resource => resource.location ?? unknownLabel, // TODO: Is location ever undefined?
            undefined,
            (location, resources): GroupingItem => this.groupingItemFactory.createLocationGroupingItem(location, {
                context,
                parent,
                resources,
                label: location,
                iconPath: new vscode.ThemeIcon('globe'),
            }),
        )
    }

    private groupByResourceGroup(parent: ResourceGroupsItem | undefined, context: ResourceGroupsTreeContext | undefined, allResources: AzureResource[]): GroupingItem[] {
        const resourceGroups: AzureResource[] = [];
        const nonResourceGroups: AzureResource[] = [];

        allResources.forEach(resource => resource.azureResourceType.type === 'microsoft.resources/resourcegroups' ? resourceGroups.push(resource) : nonResourceGroups.push(resource));

        const keySelector: (resource: AzureResource) => string = resource => resource.resourceGroup?.toLowerCase() ?? unknownLabel; // TODO: Is resource group ever undefined? Should resource group be normalized on creation?

        // Ensure grouping items are created for empty resource groups
        const initialGrouping = resourceGroups.reduce(
            (previous, next) => {
                previous[next.name.toLowerCase() ?? unknownLabel] = [];

                return previous;
            },
            {} as { [key: string]: AzureResource[] });

        return this.groupBy(
            nonResourceGroups,
            keySelector,
            initialGrouping,
            (resourceGroupName, resources): GroupingItem => {
                const resourceGroup = resourceGroups.find(resource => resource.name.toLowerCase() === resourceGroupName.toLowerCase());
                return this.groupingItemFactory.createResourceGroupGroupingItem(nonNullValue(resourceGroup, 'resourceGroup for grouping item'), {
                    context,
                    resources,
                    parent,
                    label: resourceGroupName,
                    iconPath: treeUtils.getIconPath('resourceGroup'),
                })
            },
        )
    }

    private groupByResourceType(parent: ResourceGroupsItem | undefined, context: ResourceGroupsTreeContext | undefined, allResources: AzureResource[]): GroupingItem[] {
        const initialGrouping: { [key: string]: AzureResource[] } = {};

        // Pre-populate the initial grouping with the supported resource types...
        azureExtensions.forEach(extension => {
            extension.resourceTypes.forEach(resourceType => {
                initialGrouping[resourceType] = [];
            });
        });

        // Exclude resource groups...
        allResources = allResources.filter(resource => resource.azureResourceType.type !== 'microsoft.resources/resourcegroups');

        const showHiddenTypes = settingUtils.getWorkspaceSetting<boolean>(showHiddenTypesSettingKey);

        if (!showHiddenTypes) {
            const supportedResourceTypes: AzExtResourceType[] = azureExtensions
                .map(e => e.resourceTypes)
                .reduce((a, b) => a.concat(...b), []);

            allResources = allResources.filter(resource => resource.resourceType && supportedResourceTypes.find(type => type === resource.resourceType));
        }

        return this.groupBy(
            allResources,
            resource => resource.resourceType ?? unknownLabel, // TODO: Is resource type ever undefined?
            initialGrouping,
            (resourceType, resources) => this.groupingItemFactory.createResourceTypeGroupingItem(resourceType as AzExtResourceType, {
                resources,
                context,
                parent,
                label: getName(resourceType as AzExtResourceType) ?? resourceType,
                iconPath: getIconPath(resourceType as AzExtResourceType),
            })
        );
    }
}
