import * as vscode from 'vscode';
import { ProvideResourceOptions, WorkspaceResource, WorkspaceResourceProvider } from "../v2AzureResourcesApi";

function isArray<T>(maybeArray: T[] | null | undefined): maybeArray is T[] {
    return Array.isArray(maybeArray);
}

export class WorkspaceResourceProviderManager extends vscode.Disposable {
    private readonly onDidChangeResourceEventEmitter = new vscode.EventEmitter<WorkspaceResource | undefined>();
    private readonly resourceProviders: WorkspaceResourceProvider[] = [];
    private readonly providerListeners = new Map<WorkspaceResourceProvider, vscode.Disposable>();

    private isActivating = false;

    public readonly onDidChangeResourceChange: vscode.Event<WorkspaceResource | undefined>;

    constructor(private readonly extensionActivator: () => Promise<void>) {
        super(
            () => {
                for (const listener of this.providerListeners.values()) {
                    listener.dispose();
                }

                this.onDidChangeResourceEventEmitter.dispose();
            });

        this.onDidChangeResourceChange = this.onDidChangeResourceEventEmitter.event;
    }

    addResourceProvider(resourceProvider: WorkspaceResourceProvider): void {
        this.resourceProviders.push(resourceProvider);

        if (resourceProvider.onDidChangeResource) {
            this.providerListeners.set(resourceProvider, resourceProvider.onDidChangeResource(resource => this.onDidChangeResourceEventEmitter.fire(resource)));
        }

        if (!this.isActivating) {
            this.onDidChangeResourceEventEmitter.fire(undefined);
        }
    }

    removeResourceProvider(resourceProvider: WorkspaceResourceProvider): void {
        this.resourceProviders.splice(this.resourceProviders.indexOf(resourceProvider), 1);

        const listener = this.providerListeners.get(resourceProvider);

        if (listener) {
            listener.dispose();

            this.providerListeners.delete(resourceProvider);
        }

        if (!this.isActivating) {
            this.onDidChangeResourceEventEmitter.fire(undefined);
        }
    }

    async provideResources(folder: vscode.WorkspaceFolder, options?: ProvideResourceOptions): Promise<WorkspaceResource[]> {
        await this.activateExtensions();

        const resources = await Promise.all(this.resourceProviders.map(resourceProvider => resourceProvider.provideResources(folder, options)));

        return resources.filter(isArray).reduce((acc, result) => acc?.concat(result ?? []), []);
    }

    private async activateExtensions(): Promise<void> {
        this.isActivating = true;

        try {
            await this.extensionActivator();
        } finally {
            this.isActivating = false;
        }
    }
}
