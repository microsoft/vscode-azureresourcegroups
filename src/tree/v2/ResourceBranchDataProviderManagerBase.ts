import * as vscode from 'vscode';
import { BranchDataProvider, ResourceBase, ResourceModelBase } from '../../api/v2/v2AzureResourcesApi';

export abstract class ResourceBranchDataProviderManagerBase<TBranchDataProvider extends BranchDataProvider<ResourceBase, ResourceModelBase>> extends vscode.Disposable {
    private readonly branchDataProviderMap = new Map<string, { provider: TBranchDataProvider, listener: vscode.Disposable | undefined }>();
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceModelBase | ResourceModelBase[] | undefined | null>();

    constructor(
        private readonly defaultProvider: TBranchDataProvider,
        private readonly extensionActivator: (type: string) => void
    ) {
        super(
            () => {
                this.onDidChangeTreeDataEmitter.dispose();

                for (const providerContext of this.branchDataProviderMap.values()) {
                    providerContext.listener?.dispose();
                }
            });
    }

    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    addProvider(type: string, provider: TBranchDataProvider): void {
        this.branchDataProviderMap.set(
            type,
            {
                provider,
                listener: provider.onDidChangeTreeData?.(e => this.onDidChangeTreeDataEmitter.fire(e))
            }
        );

        this.onDidChangeTreeDataEmitter.fire();
    }

    getProvider(type: string): TBranchDataProvider {
        const providerContext = this.branchDataProviderMap.get(type);

        if (providerContext) {
            return providerContext.provider;
        }

        // NOTE: The default branch data provider will be returned until the extension is loaded.
        //       The extension will then register its branch data providers, resulting in a change event.
        //       The tree will then be refreshed, resulting in this method being called again.
        this.extensionActivator(type);

        return this.defaultProvider;
    }

    removeProvider(type: string): void {
        const providerContext = this.branchDataProviderMap.get(type);

        if (providerContext) {
            providerContext.listener?.dispose();

            this.branchDataProviderMap.delete(type);

            this.onDidChangeTreeDataEmitter.fire();
        }
    }
}
