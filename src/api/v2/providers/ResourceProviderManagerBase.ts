import * as vscode from 'vscode';
import { ResourceBase, ResourceProviderBase } from '../v2AzureResourcesApi';

export abstract class ResourceProviderManagerBase<TResource extends ResourceBase, TResourceProvider extends ResourceProviderBase<TResource>> extends vscode.Disposable {
    private readonly onDidChangeResourceEventEmitter = new vscode.EventEmitter<TResource | undefined>();
    private readonly providers = new Map<TResourceProvider, { listener: vscode.Disposable | undefined }>();

    private isActivating = false;

    public readonly onDidChangeResourceChange: vscode.Event<TResource | undefined>;

    constructor(private readonly extensionActivator: () => Promise<void>) {
        super(
            () => {
                for (const context of this.providers.values()) {
                    context.listener?.dispose();
                }

                this.onDidChangeResourceEventEmitter.dispose();
            });

        this.onDidChangeResourceChange = this.onDidChangeResourceEventEmitter.event;
    }

    addResourceProvider(resourceProvider: TResourceProvider): void {
        this.providers.set(resourceProvider, { listener: resourceProvider.onDidChangeResource?.(resource => this.onDidChangeResourceEventEmitter.fire(resource)) });

        if (!this.isActivating) {
            this.onDidChangeResourceEventEmitter.fire(undefined);
        }
    }

    removeResourceProvider(resourceProvider: TResourceProvider): void {
        const context = this.providers.get(resourceProvider);

        if (context) {
            context.listener?.dispose();

            this.providers.delete(resourceProvider);
        }

        if (!this.isActivating) {
            this.onDidChangeResourceEventEmitter.fire(undefined);
        }
    }

    protected async getResourceProviders(): Promise<TResourceProvider[]> {
        await this.activateExtensions();

        return Array.from(this.providers.keys());
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
