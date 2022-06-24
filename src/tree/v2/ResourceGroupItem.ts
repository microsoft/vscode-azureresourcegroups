import * as vscode from 'vscode';

export interface ResourceGroupItem {
    getChildren(): vscode.ProviderResult<ResourceGroupItem[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
