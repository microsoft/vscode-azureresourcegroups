import * as vscode from 'vscode';
import { ApplicationResource } from '../../../api/v2/v2AzureResourcesApi';
import { getIconPath } from '../../../utils/azureUtils';
import { BuiltInResourceModelBase } from './BuiltInResourceModelBase';

export class BuiltInApplicationResourceItem implements BuiltInResourceModelBase {
    constructor(private readonly resource: ApplicationResource) {
        this.id = resource.id;
        this.name = resource.name;
    }

    // needed for view properties
    public get data(): Record<string, unknown> {
        return this.resource._raw;
    }

    getChildren(): vscode.ProviderResult<BuiltInResourceModelBase[]> {
        return undefined;
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.resource.name ?? 'Unnamed Resource');

        treeItem.iconPath = getIconPath(this.resource.azExtResourceType);
        treeItem.contextValue = 'azureResource';
        return treeItem;
    }

    public get quickPickOptions(): { readonly contextValues: string[]; readonly isLeaf: boolean; } {
        return {
            contextValues: [],
            isLeaf: true,
        };
    }

    id: string;
    name: string;
    type: string;
}
