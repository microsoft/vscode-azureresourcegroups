import { TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { ApplicationResourceChildItem } from './ApplicationResourceChildItem';
import { ResourceGroupResourceBase } from './ResourceGroupResourceBase';

// TODO: Remove in favor of reusing ApplicationResourceChildItem (having the parent make the initial getResourceItem() call)?
export class GroupingItem implements ResourceGroupResourceBase {
    private
    constructor(
        private readonly branchDataProviderFactory: (ApplicationResource) => BranchDataProvider<ApplicationResource, ResourceModelBase>,
        private readonly iconPath: TreeItemIconPath | undefined,
        public readonly label: string,
        private readonly resources: ApplicationResource[]) {
    }

    async getChildren(): Promise<ResourceGroupResourceBase[] | undefined> {
        const resourceItems = await Promise.all(this.resources.map(
            async resource => {
                const branchDataProvider = this.branchDataProviderFactory(resource);
                const resourceItem = await branchDataProvider.getResourceItem(resource);

                return new ApplicationResourceChildItem(branchDataProvider, resourceItem);
            }));

        return resourceItems;
    }

    async getTreeItem(): Promise<vscode.TreeItem> {
        const treeItem = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);

        treeItem.iconPath = this.iconPath;

        return treeItem;
    }

    id: string;
    name: string;
    type: string;
}
