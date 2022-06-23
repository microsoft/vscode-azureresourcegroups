import * as vscode from 'vscode';
import { ApplicationResource } from '../../api/v2/v2AzureResourcesApi';
import { GroupBySettings } from '../../commands/explorer/groupBy';
import { ext } from '../../extensionVariables';
import { settingUtils } from '../../utils/settingUtils';
import { ApplicationResourceItem } from './ApplicationResourceItem';
import { GenericItem } from './GenericItem';
import { localize } from "../../utils/localize";
import { treeUtils } from '../../utils/treeUtils';

export class ApplicationResourceGroupingManager extends vscode.Disposable {
    private readonly onDidChangeGroupingEmitter = new vscode.EventEmitter<void>();
    private readonly configSubscription: vscode.Disposable;

    constructor() {
        super(
            () =>
            {
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

    groupResources(resources: ApplicationResource[]): GenericItem[] {
        const groupBy = settingUtils.getWorkspaceSetting<string>('groupBy');

        if (groupBy?.startsWith('armTag')) {
            const tag = groupBy.substring('armTag'.length + 1);

            return this.groupByArmTag(resources, tag);
        }

        switch (groupBy) {
            case GroupBySettings.Location:

                return this.groupByLocation(resources);

            case GroupBySettings.ResourceType:

                return this.groupByResourceType(resources);

            case GroupBySettings.ResourceGroup:
            default:

                return this.groupByResourceGroup(resources);
        }
    }

    // TODO: Consolidate repeated grouping logic.
    private groupByArmTag(resources: ApplicationResource[], tag: string): GenericItem[] {
        const ungroupedKey = 'ungrouped';
        const map = resources.reduce(
            (acc, resource) => {
                const key = resource.tags?.[tag] ?? ungroupedKey;
                let children = acc[key];

                if (!children) {
                    acc[key] = children = [];
                }

                children.push(new ApplicationResourceItem(resource));

                return acc;
            },
            <{ [key: string]: ApplicationResourceItem[] }>{});

        return Object.keys(map).sort((a, b) => a.localeCompare(b)).map(key => {
            return new GenericItem(
                key !== ungroupedKey ? key : localize('ungrouped', 'ungrouped'),
                {
                    children: map[key],
                    iconPath: new vscode.ThemeIcon(key !== ungroupedKey ? 'tag' : 'json')
                });
        });
    }

    private groupByLocation(resources: ApplicationResource[]): GenericItem[] {
        const map = resources.reduce(
            (acc, resource) => {
                const key = resource.location ?? 'Unknown'; // TODO: Is location ever undefined?
                let children = acc[key];

                if (!children) {
                    acc[key] = children = [];
                }

                children.push(new ApplicationResourceItem(resource));

                return acc;
            },
            <{ [key: string]: ApplicationResourceItem[] }>{});

        return Object.keys(map).sort((a, b) => a.localeCompare(b)).map(key => {
            return new GenericItem(
                key,
                {
                    children: map[key],
                    iconPath: new vscode.ThemeIcon('globe')
                });
        });
    }

    private groupByResourceGroup(resources: ApplicationResource[]): GenericItem[] {
        const map = resources.reduce(
            (acc, resource) => {
                const key = resource.resourceGroup ?? 'Unknown'; // TODO: Is resource group ever undefined?
                let children = acc[key];

                if (!children) {
                    acc[key] = children = [];
                }

                children.push(new ApplicationResourceItem(resource));

                return acc;
            },
            <{ [key: string]: ApplicationResourceItem[] }>{});

        return Object.keys(map).sort((a, b) => a.localeCompare(b)).map(key => {
            return new GenericItem(
                key,
                {
                    children: map[key],
                    iconPath: treeUtils.getIconPath('resourceGroup')
                });
        });
    }

    private groupByResourceType(resources: ApplicationResource[]): GenericItem[] {
        const map = resources.reduce(
            (acc, resource) => {
                const key = resource.type ?? 'Unknown'; // TODO: Is resource type ever undefined?
                let children = acc[key];

                if (!children) {
                    acc[key] = children = [];
                }

                children.push(new ApplicationResourceItem(resource));

                return acc;
            },
            <{ [key: string]: ApplicationResourceItem[] }>{});

        return Object.keys(map).sort((a, b) => a.localeCompare(b)).map(key => {
            return new GenericItem(
                key,
                {
                    children: map[key],
                    iconPath: treeUtils.getIconPath('resourceGroup')
                });
        });
    }
}
