import * as vscode from 'vscode';
import { ResourceBase } from "../../api/v2/v2AzureResourcesApi";

export interface ResourceGroupResourceBase extends ResourceBase {
    getChildren(): vscode.ProviderResult<ResourceGroupResourceBase[]>;
    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;
}
