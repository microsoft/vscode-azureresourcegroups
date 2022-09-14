import { FindableByIdTreeNodeV2 } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';

export interface ResourceGroupsItem extends FindableByIdTreeNodeV2 {
    getChildren(): vscode.ProviderResult<ResourceGroupsItem[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
