import * as vscode from "vscode";
import { ApplicationResourceProviderManager } from "../../api/v2/providers/ApplicationResourceProviderManager";
import { treeUtils } from "../../utils/treeUtils";
import { ApplicationResourceGroupingManager } from "./ApplicationResourceGroupingManager";
import { ResourceGroupItem } from "./ResourceGroupItem";
import { ResourceGroupsTreeContext } from "./ResourceGroupsTreeContext";

export class SubscriptionItem implements ResourceGroupItem {
    constructor(
        private readonly context: ResourceGroupsTreeContext,
        private readonly resourceGroupingManager: ApplicationResourceGroupingManager,
        private readonly resourceProviderManager: ApplicationResourceProviderManager) {
    }

    async getChildren(): Promise<ResourceGroupItem[]> {
        const resources = await this.resourceProviderManager.provideResources(this.context.subscription);

        return this.resourceGroupingManager.groupResources(this.context, resources ?? []).sort((a, b) => a.label.localeCompare(b.label));
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.context.subscription.displayName ?? 'Unnamed', vscode.TreeItemCollapsibleState.Collapsed);

        treeItem.contextValue = 'azureextensionui.azureSubscription';
        treeItem.iconPath = treeUtils.getIconPath('azureSubscription');
        treeItem.id = this.context.subscription.subscriptionId;

        return treeItem;
    }

    id: string;
    name: string;
    type: string;
}
