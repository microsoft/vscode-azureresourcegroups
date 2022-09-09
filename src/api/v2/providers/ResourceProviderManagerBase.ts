import * as vscode from 'vscode';
import { ResourceBase, ResourceProviderBase } from '../v2AzureResourcesApi';

export abstract class ResourceProviderManagerBase<TResource extends ResourceBase, TResourceProvider extends ResourceProviderBase<TResource>> extends vscode.Disposable {
    private readonly onDidChangeResourceEventEmitter = new vscode.EventEmitter<TResource | undefined>();
    private readonly resourceProviders: TResourceProvider[] = [];
    private readonly providerListeners = new Map<TResourceProvider, vscode.Disposable>();

    private isActivating = false;

    public readonly onDidChangeResourceChange: vscode.Event<TResource | undefined>;

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

    addResourceProvider(resourceProvider: TResourceProvider): void {
        this.resourceProviders.push(resourceProvider);

        if (resourceProvider.onDidChangeResource) {
            this.providerListeners.set(resourceProvider, resourceProvider.onDidChangeResource(resource => this.onDidChangeResourceEventEmitter.fire(resource)));
        }

        if (!this.isActivating) {
            this.onDidChangeResourceEventEmitter.fire(undefined);
        }
    }

    removeResourceProvider(resourceProvider: TResourceProvider): void {
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

    protected async getResourceProviders(): Promise<TResourceProvider[]> {
        await this.activateExtensions();

        return this.resourceProviders;
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
