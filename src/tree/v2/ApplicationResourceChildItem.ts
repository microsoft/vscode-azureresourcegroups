import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';
import { ResourceGroupResourceBase } from './ResourceGroupResourceBase';

export class ApplicationResourceChildItem implements ResourceGroupResourceBase {
    constructor(
        private readonly branchDataProvider: BranchDataProvider<ApplicationResource, ResourceModelBase>,
        private readonly child: ResourceModelBase) {
    }

    async  getChildren(): Promise<ResourceGroupResourceBase[] | undefined> {
        const children = await this.branchDataProvider.getChildren(this.child);

        return children?.map(child => new ApplicationResourceChildItem(this.branchDataProvider, child));
    }

    getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return this.branchDataProvider.getTreeItem(this.child);
    }

    id: string;
    name: string;
    type: string;
}
