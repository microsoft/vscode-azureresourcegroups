import * as vscode from 'vscode';

export interface WorkspaceItem {
    getChildren(): vscode.ProviderResult<WorkspaceItem[]>;

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
