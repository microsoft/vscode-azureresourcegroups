/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { isArray } from '../../utils/v2/isArray';
import { ApplicationResource, ApplicationResourceProvider, ApplicationSubscription, ProvideResourceOptions, ResourceBase, ResourceProviderBase, WorkspaceResource, WorkspaceResourceProvider } from './v2AzureResourcesApi';

class ResourceProviderManagerBase<TResourceSource, TResource extends ResourceBase, TResourceProvider extends ResourceProviderBase<TResourceSource, TResource>> extends vscode.Disposable {
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

    async getResources(source: TResourceSource, options?: ProvideResourceOptions): Promise<TResource[]> {
        const resourceProviders = await this.getResourceProviders();

        const resources = await Promise.all(resourceProviders.map(resourceProvider => resourceProvider.getResources(source, options)));

        return resources.filter(isArray).reduce((acc, result) => acc?.concat(result ?? []), []);
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

// NOTE: TS doesn't seem to like exporting a type alias (i.e. you cannot instantiate it),
//       so we still have to extend the class.

export class ApplicationResourceProviderManager extends ResourceProviderManagerBase<ApplicationSubscription, ApplicationResource, ApplicationResourceProvider> {
}

export class WorkspaceResourceProviderManager extends ResourceProviderManagerBase<vscode.WorkspaceFolder, WorkspaceResource, WorkspaceResourceProvider> {
}
