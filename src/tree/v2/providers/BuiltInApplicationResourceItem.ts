import * as vscode from 'vscode';
import { ApplicationResource } from '../../../api/v2/v2AzureResourcesApi';
import { CanViewProperties, ViewPropertiesModel } from '../../../commands/viewProperties';
import { getIconPath } from '../../../utils/azureUtils';
import { BuiltInResourceModelBase } from './BuiltInResourceModelBase';

export class BuiltInApplicationResourceItem implements BuiltInResourceModelBase, CanViewProperties {
    constructor(private readonly resource: ApplicationResource) { }

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

    public get viewProperties(): ViewPropertiesModel {
        return {
            id: this.resource.id,
            label: this.resource.name,
            data: this.resource._raw,
        }
    }

    id: string;
    name: string;
    type: string;
}
