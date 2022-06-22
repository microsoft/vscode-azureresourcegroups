import * as vscode from 'vscode';
import { ApplicationResource } from '../../api/v2/v2AzureResourcesApi';
import { ResourceGroupResourceBase } from './ResourceGroupResourceBase';

export class ApplicationResourceItem implements ResourceGroupResourceBase {
    constructor(private readonly resource: ApplicationResource) {
    }

    getChildren(): vscode.ProviderResult<ResourceGroupResourceBase[]> {
        return undefined;
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.resource.name ?? 'Unnamed Resource');

        return treeItem;
    }

    id: string;
    name: string;
    type: string;
}
