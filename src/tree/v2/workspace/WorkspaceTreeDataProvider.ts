import * as vscode from 'vscode';
import { WorkspaceResourceProviderManager } from '../../../api/v2/WorkspaceResourceProviderManager';
import { WorkspaceResource } from '../../../api/v2/v2AzureResourcesApi';
import { BranchDataItem } from '../BranchDataItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceGroupsItemCache } from '../ResourceGroupsItemCache';
import { ResourceTreeDataProviderBase } from '../ResourceTreeDataProviderBase';
import { WorkspaceResourceBranchDataProviderManager } from './WorkspaceResourceBranchDataProviderManager';

export class WorkspaceTreeDataProvider extends ResourceTreeDataProviderBase {
    constructor(
        private readonly branchDataProviderManager: WorkspaceResourceBranchDataProviderManager,
        onRefresh: vscode.Event<void>,
        private readonly resourceProviderManager: WorkspaceResourceProviderManager) {
        super(
            new ResourceGroupsItemCache(),
            branchDataProviderManager.onDidChangeTreeData,
            resourceProviderManager.onDidChangeResourceChange,
            onRefresh);
    }

    async onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        if (element) {
            return await element.getChildren();
        }
        else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const resources = await this.resourceProviderManager.provideResources(vscode.workspace.workspaceFolders[0]);

            if (resources) {
                return Promise.all(resources.map(resource => this.getWorkspaceItemModel(resource)));
            }
        }

        return [];
    }

    private async getWorkspaceItemModel(resource: WorkspaceResource): Promise<ResourceGroupsItem> {
        const branchDataProvider = this.branchDataProviderManager.getProvider(resource.type);

        const resourceItem = await branchDataProvider.getResourceItem(resource);

        return new BranchDataItem(resourceItem, branchDataProvider, this.itemCache);
    }
}