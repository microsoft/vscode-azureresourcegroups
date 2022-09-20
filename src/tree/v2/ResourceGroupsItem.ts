import * as vscode from 'vscode';
import { ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';

export interface ResourceGroupsItem extends ResourceModelBase {
    getChildren(): vscode.ProviderResult<ResourceGroupsItem[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
