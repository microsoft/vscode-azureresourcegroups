import * as vscode from 'vscode';
import { WorkspaceItemModel } from './WorkspaceItemModel';

export class WorkspaceTreeDataProvider implements vscode.TreeDataProvider<WorkspaceItemModel> {
    onDidChangeTreeData?: vscode.Event<void | WorkspaceItemModel | WorkspaceItemModel[] | null | undefined> | undefined;

    getChildren(element?: WorkspaceItemModel | undefined): vscode.ProviderResult<WorkspaceItemModel[]> {
        if (element) {
            return element.getChildren();
        }
        else {
            // TODO: Implement this!
            return [];
        }
    }

    getTreeItem(element: WorkspaceItemModel): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    getParent?(_element: WorkspaceItemModel): vscode.ProviderResult<WorkspaceItemModel> {
        throw new Error('Method not implemented.');
    }

    resolveTreeItem?(_item: vscode.TreeItem, _element: WorkspaceItemModel, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }
}
