import * as vscode from 'vscode';

export interface ResourceGroupsItem {
    getChildren(): vscode.ProviderResult<ResourceGroupsItem[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
