import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { ApplicationResourceChildItem } from './ApplicationResourceChildItem';
import { ResourceGroupResourceBase } from './ResourceGroupResourceBase';

// TODO: Remove in favor of reusing ApplicationResourceChildItem (having the parent make the initial getResourceItem() call)?
export class ApplicationResourceItem implements ResourceGroupResourceBase {
    private
    constructor(
        private readonly branchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>,
        private readonly resource: ApplicationResource) {
    }

    async getChildren(): Promise<ResourceGroupResourceBase[] | undefined> {
        // TODO: Should the resource be cached?
        const resourceItem = await this.branchDataProvider.getResourceItem(this.resource);

        if (resourceItem) {
            const children = await this.branchDataProvider.getChildren(resourceItem);

            return children?.map(child => new ApplicationResourceChildItem(this.branchDataProvider, child));
        }

        return undefined;
    }

    async getTreeItem(): Promise<vscode.TreeItem> {
        // TODO: Should the resource be cached?
        const resourceItem = await this.branchDataProvider.getResourceItem(this.resource);

        return this.branchDataProvider.getTreeItem(resourceItem);
    }

    id: string;
    name: string;
    type: string;
}
