import * as vscode from "vscode";
import { ApplicationResourceProviderManager } from "../../api/v2/providers/ApplicationResourceProviderManager";
import { ApplicationSubscription } from "../../api/v2/v2AzureResourcesApi";
import { treeUtils } from "../../utils/treeUtils";
import { AzureSubscription } from "./azure-account.api";
import { ResourceGroupResourceBase } from "./ResourceGroupResourceBase";
import { ApplicationResourceGroupingManager } from "./ApplicationResourceGroupingManager";

export class SubscriptionItem implements ResourceGroupResourceBase {
    constructor(
        private readonly azureSubscription: AzureSubscription,
        private readonly resourceGroupingManager: ApplicationResourceGroupingManager,
        private readonly resourceProviderManager: ApplicationResourceProviderManager) {
    }

    async getChildren(): Promise<ResourceGroupResourceBase[]> {
        const subscription: ApplicationSubscription = {
            credentials: this.azureSubscription.session.credentials2,
            environment: this.azureSubscription.session.environment,
            isCustomCloud: this.azureSubscription.session.environment.name === 'AzureCustomCloud',
            subscriptionId: this.azureSubscription.subscription.subscriptionId || 'TODO: ever undefined?',
        };

        const resources = await this.resourceProviderManager.provideResources(subscription);

        return this.resourceGroupingManager.groupResources(resources ?? []).sort((a, b) => a.label.localeCompare(b.label));
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
}
