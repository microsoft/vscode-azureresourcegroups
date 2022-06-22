import * as vscode from 'vscode';

export interface ResourceGroupResourceBase {
    getChildren(): vscode.ProviderResult<ResourceGroupResourceBase[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
