/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AzExtResourceType, AzureResource } from '../../../api/src/index';
import { azureExtensions } from '../../azureExtensions';
import { GroupBySettings } from '../../commands/explorer/groupBy';
import { ext } from '../../extensionVariables';
import { getIconPath, getName } from '../../utils/azureUtils';
import { localize } from "../../utils/localize";
import { treeUtils } from '../../utils/treeUtils';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceGroupsTreeContext } from '../ResourceGroupsTreeContext';
import { GroupingItem, GroupingItemFactory } from './GroupingItem';

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

    private groupBy(parent: ResourceGroupsItem | undefined, context: ResourceGroupsTreeContext | undefined, resources: AzureResource[], keySelector: (resource: AzureResource) => string, labelSelector: (key: string) => string, iconSelector: (key: string) => TreeItemIconPath | undefined, initialGrouping?: { [key: string]: AzureResource[] }, contextValues?: string[], resourceTypeSelector?: (key: string) => AzExtResourceType | undefined, resourceGroupSelector?: (key: string) => AzureResource | undefined, locationSelector?: (key: string) => string): GroupingItem[] {
        initialGrouping = initialGrouping ?? {};

        const map = resources.reduce(
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

        return Object.keys(map).map(key => {
            return this.groupingItemFactory(
                context,
                [...(contextValues ?? []), key],
                iconSelector(key),
                labelSelector(key),
                map[key],
                resourceTypeSelector?.(key),
                parent,
                resourceGroupSelector?.(key),
                locationSelector?.(key));
        });
    }

    private groupByArmTag(parent: ResourceGroupsItem | undefined, context: ResourceGroupsTreeContext | undefined, resources: AzureResource[], tag: string): GroupingItem[] {
        const ungroupedKey = 'ungrouped';
        return this.groupBy(
            parent,
            context,
            resources,
            resource => resource.tags?.[tag] ?? ungroupedKey,
            key => key !== ungroupedKey ? key : localize('ungrouped', 'ungrouped'),
            key => new vscode.ThemeIcon(key !== ungroupedKey ? 'tag' : 'json'));
    }

    private groupByLocation(parent: ResourceGroupsItem | undefined, context: ResourceGroupsTreeContext | undefined, resources: AzureResource[]): GroupingItem[] {
        return this.groupBy(
            parent,
            context,
            resources,
            resource => resource.location ?? unknownLabel, // TODO: Is location ever undefined?
            key => key,
            () => new vscode.ThemeIcon('globe'),
            undefined,
            ['locationGroup'],
            undefined,
            undefined,
            key => key);
    }

    private groupByResourceGroup(parent: ResourceGroupsItem | undefined, context: ResourceGroupsTreeContext | undefined, resources: AzureResource[]): GroupingItem[] {
        const resourceGroups: AzureResource[] = [];
        const nonResourceGroups: AzureResource[] = [];

        resources.forEach(resource => resource.azureResourceType.type === 'microsoft.resources/resourcegroups' ? resourceGroups.push(resource) : nonResourceGroups.push(resource));

        const keySelector: (resource: AzureResource) => string = resource => resource.resourceGroup?.toLowerCase() ?? unknownLabel; // TODO: Is resource group ever undefined? Should resource group be normalized on creation?

        const initialGrouping = resourceGroups.reduce(
            (previous, next) => {
                previous[next.name.toLowerCase() ?? unknownLabel] = [];

                return previous;
            },
            {} as { [key: string]: AzureResource[] });

        const groupedResources = this.groupBy(
            parent,
            context,
            nonResourceGroups,
            keySelector,
            key => key,
            () => treeUtils.getIconPath('resourceGroup'),
            initialGrouping,
            ['azureResourceGroup'],
            undefined,
            key => resourceGroups.find(resource => resource.name.toLowerCase() === key.toLowerCase()));

        return groupedResources;
    }

    private groupByResourceType(parent: ResourceGroupsItem | undefined, context: ResourceGroupsTreeContext | undefined, resources: AzureResource[]): GroupingItem[] {
        const initialGrouping: { [key: string]: AzureResource[] } = {};

        // Pre-populate the initial grouping with the supported resource types...
        azureExtensions.forEach(extension => {
            extension.resourceTypes.forEach(resourceType => {
                initialGrouping[resourceType] = [];
            });
        });

        // Exclude resource groups...
        resources = resources.filter(resource => resource.azureResourceType.type !== 'microsoft.resources/resourcegroups');

        return this.groupBy(
            parent,
            context,
            resources,
            resource => resource.resourceType ?? unknownLabel, // TODO: Is resource type ever undefined?
            key => getName(key as AzExtResourceType) ?? key,
            key => getIconPath(key as AzExtResourceType), // TODO: What's the default icon for a resource type?
            initialGrouping,
            ['azureResourceTypeGroup'],
            key => key as AzExtResourceType);
    }
}
