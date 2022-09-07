import * as vscode from 'vscode';
import { WorkspaceResourceProviderManager } from '../../../api/v2/providers/WorkspaceResourceProviderManager';
import { WorkspaceResource } from '../../../api/v2/v2AzureResourcesApi';
import { BranchDataProviderItem } from './BranchDataProviderItem';
import { WorkspaceItem } from './WorkspaceItem';
import { WorkspaceResourceBranchDataProviderManager } from './WorkspaceResourceBranchDataProviderManager';

export class WorkspaceTreeDataProvider extends vscode.Disposable implements vscode.TreeDataProvider<WorkspaceItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | WorkspaceItem | WorkspaceItem[] | null | undefined>();
    private readonly providerManagerListener: vscode.Disposable;

    private readonly refreshListener: vscode.Disposable;

    constructor(
        private readonly branchDataProviderManager: WorkspaceResourceBranchDataProviderManager,
        refreshEvent: vscode.Event<void>,
        private readonly resourceProviderManager: WorkspaceResourceProviderManager) {
        super(
            () => {
                this.onDidChangeTreeDataEmitter.dispose();
                this.providerManagerListener.dispose();
                this.refreshListener.dispose();
            });

        this.providerManagerListener = this.resourceProviderManager.onDidChangeResourceChange(
            () => {
                // TODO: Currently resetting entire tree; need to whittle down to just the correct nodes (if possible).
                this.onDidChangeTreeDataEmitter.fire();
            });

        this.refreshListener = refreshEvent(
            () => {
                this.onDidChangeTreeDataEmitter.fire();
            });
    }

    onDidChangeTreeData?: vscode.Event<void | WorkspaceItem | WorkspaceItem[] | null | undefined> = this.onDidChangeTreeDataEmitter.event;

    async getChildren(element?: WorkspaceItem | undefined): Promise<WorkspaceItem[] | null | undefined> {
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

    private async getWorkspaceItemModel(resource: WorkspaceResource): Promise<WorkspaceItem> {
        const branchDataProvider = this.branchDataProviderManager.getApplicationResourceBranchDataProvider(resource.type);

        const resourceItem = await branchDataProvider.getResourceItem(resource);

        return new BranchDataProviderItem(branchDataProvider, resourceItem);
    }

    getTreeItem(element: WorkspaceItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    getParent?(_element: WorkspaceItem): vscode.ProviderResult<WorkspaceItem> {
        throw new Error('Method not implemented.');
    }

    resolveTreeItem?(_item: vscode.TreeItem, _element: WorkspaceItem, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error('Method not implemented.');
    }
}
