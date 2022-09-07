import * as vscode from 'vscode';
import { ResourceGroupsExtensionManager } from '../../../api/v2/ResourceGroupsExtensionManager';
import { BranchDataProvider, ResourceModelBase, WorkspaceResource } from '../../../api/v2/v2AzureResourcesApi';

export class WorkspaceResourceBranchDataProviderManager extends vscode.Disposable {
    private readonly branchDataProviders = new Map<string, { provider: BranchDataProvider<WorkspaceResource, ResourceModelBase>, listener: vscode.Disposable | undefined }>();
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceModelBase | ResourceModelBase[] | undefined | null>();

    constructor(
        private readonly defaultBranchDataProvider: BranchDataProvider<WorkspaceResource, ResourceModelBase>,
        private readonly extensionManager: ResourceGroupsExtensionManager
    ) {
        super(
            () => {
                this.onDidChangeTreeDataEmitter.dispose();

                for (const branchDataProviderData of this.branchDataProviders.values()) {
                    if (branchDataProviderData.listener) {
                        branchDataProviderData.listener.dispose();
                    }
                }
            });
    }

    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    addBranchDataProvider(type: string, provider: BranchDataProvider<WorkspaceResource, ResourceModelBase>): void {
        this.branchDataProviders.set(
            type,
            {
                provider,
                listener: provider.onDidChangeTreeData ? provider.onDidChangeTreeData(e => this.onDidChangeTreeDataEmitter.fire(e)) : undefined
            }
        );
    }

    getApplicationResourceBranchDataProvider(type: string): BranchDataProvider<WorkspaceResource, ResourceModelBase> {
        const provider = this.branchDataProviders.get(type);

        if (provider) {
            return provider.provider;
        }

        // NOTE: The default branch data provider will be returned until the extension is loaded.
        //       The extension will then register its branch data providers, resulting in a change event.
        //       The tree will then be refreshed, resulting in this method being called again.
        void this.extensionManager.activateWorkspaceResourceBranchDataProvider(type);

        return this.defaultBranchDataProvider;
    }

    removeBranchDataProvider(type: string): void {
        const branchDataProvider = this.branchDataProviders.get(type);

        if (branchDataProvider) {
            if (branchDataProvider.listener) {
                branchDataProvider.listener.dispose();
            }

            this.branchDataProviders.delete(type);
        }
    }
}
