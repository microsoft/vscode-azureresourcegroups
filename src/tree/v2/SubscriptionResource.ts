import * as vscode from "vscode";
import { treeUtils } from "../../utils/treeUtils";
import { AzureSubscription } from "./azure-account.api";
import { ResourceGroupResourceBase } from "./ResourceGroupResourceBase";

export class SubscriptionResource implements ResourceGroupResourceBase {
    constructor(private readonly subscription: AzureSubscription) {
    }

    getChildren(): vscode.ProviderResult<ResourceGroupResourceBase[]> {
        throw new Error("Method not implemented.");
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.subscription.subscription.displayName ?? 'Unnamed', vscode.TreeItemCollapsibleState.Collapsed);

        treeItem.contextValue = 'azureextensionui.azureSubscription';
        treeItem.iconPath = treeUtils.getIconPath('azureSubscription');
        treeItem.id = this.subscription.subscription.id;

        return treeItem;
    }

    id: string;
    name: string;
    type: string;
}
