import * as vscode from "vscode";
import { ApplicationResourceProviderManager } from "../../api/v2/providers/ApplicationResourceProviderManager";
import { ApplicationResource, ApplicationSubscription } from "../../api/v2/v2AzureResourcesApi";
import { GroupBySettings } from "../../commands/explorer/groupBy";
import { settingUtils } from "../../utils/settingUtils";
import { treeUtils } from "../../utils/treeUtils";
import { ApplicationResourceItem } from "./ApplicationResourceItem";
import { AzureSubscription } from "./azure-account.api";
import { GenericItem } from "./GenericItem";
import { ResourceGroupResourceBase } from "./ResourceGroupResourceBase";

export class SubscriptionItem implements ResourceGroupResourceBase {
    constructor(private readonly azureSubscription: AzureSubscription, private readonly resourceProviderManager: ApplicationResourceProviderManager) {
    }

    async getChildren(): Promise<ResourceGroupResourceBase[]> {
        const subscription: ApplicationSubscription = {
            credentials: this.azureSubscription.session.credentials2,
            environment: this.azureSubscription.session.environment,
            isCustomCloud: this.azureSubscription.session.environment.name === 'AzureCustomCloud',
            subscriptionId: this.azureSubscription.subscription.subscriptionId || 'TODO: ever undefined?',
        };

        const resources = await this.resourceProviderManager.provideResources(subscription);

        return this.groupResources(resources ?? []);
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.azureSubscription.subscription.displayName ?? 'Unnamed', vscode.TreeItemCollapsibleState.Collapsed);

        treeItem.contextValue = 'azureextensionui.azureSubscription';
        treeItem.iconPath = treeUtils.getIconPath('azureSubscription');
        treeItem.id = this.azureSubscription.subscription.id;

        return treeItem;
    }

    id: string;
    name: string;
    type: string;

    // TODO: Consolidate repeated grouping logic.
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

    private groupResources(resources: ApplicationResource[]): GenericItem[] {
        const groupBy = settingUtils.getWorkspaceSetting<string>('groupBy');

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
}
