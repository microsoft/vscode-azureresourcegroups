import { AzExtResourceType, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ApplicationResource } from '../../api/v2/v2AzureResourcesApi';
import { GroupBySettings } from '../../commands/explorer/groupBy';
import { ext } from '../../extensionVariables';
import { getIconPath, getName } from '../../utils/azureUtils';
import { localize } from "../../utils/localize";
import { settingUtils } from '../../utils/settingUtils';
import { treeUtils } from '../../utils/treeUtils';
import { GroupingItem, GroupingItemFactory } from './GroupingItem';
import { ResourceGroupsTreeContext } from './ResourceGroupsTreeContext';

const unknownLabel = localize('unknown', 'unknown');

export class ApplicationResourceGroupingManager extends vscode.Disposable {
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

    groupResources(context: ResourceGroupsTreeContext, resources: ApplicationResource[]): GroupingItem[] {
        const groupBy = settingUtils.getWorkspaceSetting<string>('groupBy');

        if (groupBy?.startsWith('armTag')) {
            const tag = groupBy.substring('armTag'.length + 1);

            return this.groupByArmTag(context, resources, tag);
        }

        switch (groupBy) {
            case GroupBySettings.Location:

                return this.groupByLocation(context, resources);

            case GroupBySettings.ResourceType:

                return this.groupByResourceType(context, resources);

            case GroupBySettings.ResourceGroup:
            default:

                return this.groupByResourceGroup(context, resources);
        }
    }

    private groupBy(context: ResourceGroupsTreeContext, resources: ApplicationResource[], keySelector: (resource: ApplicationResource) => string, labelSelector: (key: string) => string, iconSelector: (key: string) => TreeItemIconPath | undefined, initialGrouping?: { [key: string]: ApplicationResource[] }, contextValues?: string[], resourceTypeSelector?: (key: string) => string | undefined): GroupingItem[] {
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
                contextValues,
                iconSelector(key),
                labelSelector(key),
                map[key],
                resourceTypeSelector?.(key)
            );
        });
    }

    private groupByArmTag(context: ResourceGroupsTreeContext, resources: ApplicationResource[], tag: string): GroupingItem[] {
        const ungroupedKey = 'ungrouped';
        return this.groupBy(
            context,
            resources,
            resource => resource.tags?.[tag] ?? ungroupedKey,
            key => key !== ungroupedKey ? key : localize('ungrouped', 'ungrouped'),
            key => new vscode.ThemeIcon(key !== ungroupedKey ? 'tag' : 'json'));
    }

    private groupByLocation(context: ResourceGroupsTreeContext, resources: ApplicationResource[]): GroupingItem[] {
        return this.groupBy(
            context,
            resources,
            resource => resource.location ?? unknownLabel, // TODO: Is location ever undefined?
            key => key,
            () => new vscode.ThemeIcon('globe'));
    }

    private groupByResourceGroup(context: ResourceGroupsTreeContext, resources: ApplicationResource[]): GroupingItem[] {
        const resourceGroups: ApplicationResource[] = [];
        const nonResourceGroups: ApplicationResource[] = [];

        resources.forEach(resource => resource.type.type === 'microsoft.resources/resourcegroups' ? resourceGroups.push(resource) : nonResourceGroups.push(resource));

        const keySelector: (resource: ApplicationResource) => string = resource => resource.resourceGroup?.toLowerCase() ?? unknownLabel; // TODO: Is resource group ever undefined? Should resource group be normalized on creation?

        const initialGrouping = resourceGroups.reduce(
            (previous, next) => {
                previous[next.name.toLowerCase() ?? unknownLabel] = [];

                return previous;
            },
            {});

        const groupedResources = this.groupBy(
            context,
            nonResourceGroups,
            keySelector,
            key => key,
            () => treeUtils.getIconPath('resourceGroup'),
            initialGrouping,
            ['azureResourceGroup']);

        return groupedResources;
    }

    private groupByResourceType(context: ResourceGroupsTreeContext, resources: ApplicationResource[]): GroupingItem[] {
        return this.groupBy(
            context,
            resources,
            resource => resource.azExtResourceType ?? resource.type.type, // TODO: Is resource type ever undefined?
            key => getName(key as AzExtResourceType) ?? key,
            key => getIconPath(key as AzExtResourceType)); // TODO: What's the default icon for a resource type?
    }
}
