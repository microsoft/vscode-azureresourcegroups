import * as vscode from 'vscode';
import { ResourceGroupResourceBase } from './ResourceGroupResourceBase';

export class ResourceGroupsTreeDataProvider implements vscode.TreeDataProvider<ResourceGroupResourceBase> {
    onDidChangeTreeData?: vscode.Event<void | ResourceGroupResourceBase | null | undefined> | undefined;

    getTreeItem(element: ResourceGroupResourceBase): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    getChildren(element?: ResourceGroupResourceBase | undefined): vscode.ProviderResult<ResourceGroupResourceBase[]> {
        if (element) {
            return element.getChildren();
        } else {
            // TODO: Return subscriptions.
            return [];
        }
    }
}
