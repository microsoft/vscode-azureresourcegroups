import * as vscode from 'vscode';

export interface WorkspaceItemModel {
    getChildren(): vscode.ProviderResult<WorkspaceItemModel[]>;

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
