import * as vscode from 'vscode';
import { BranchDataProvider, ResourceModelBase, WorkspaceResource } from '../../../api/v2/v2AzureResourcesApi';
import { WorkspaceItem } from "./WorkspaceItem";

export class BranchDataProviderItem implements WorkspaceItem {
    constructor(
        private readonly branchDataProvider: BranchDataProvider<WorkspaceResource, ResourceModelBase>,
        private readonly item: ResourceModelBase) {
    }

    async getChildren(): Promise<WorkspaceItem[]> {
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
