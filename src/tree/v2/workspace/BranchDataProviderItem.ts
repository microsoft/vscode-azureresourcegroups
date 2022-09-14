import * as vscode from 'vscode';
import { BranchDataProvider, ResourceModelBase, WorkspaceResource } from '../../../api/v2/v2AzureResourcesApi';
import { ResourceGroupsItem } from '../ResourceGroupsItem';

export class BranchDataProviderItem implements ResourceGroupsItem {
    constructor(
        private readonly branchDataProvider: BranchDataProvider<WorkspaceResource, ResourceModelBase>,
        private readonly item: ResourceModelBase) {
    }

    async getChildren(): Promise<ResourceGroupsItem[]> {
        const children = await this.branchDataProvider.getChildren(this.item);

        return children?.map(child => new BranchDataProviderItem(this.branchDataProvider, child)) ?? [];
    }

    async getTreeItem(): Promise<vscode.TreeItem> {
        const treeItem = await this.branchDataProvider.getTreeItem(this.item);

        // NOTE: We create a copy to ensure immutability and allow insertion of defaults/overrides.
        return {
            ...treeItem
        };
    }
}
