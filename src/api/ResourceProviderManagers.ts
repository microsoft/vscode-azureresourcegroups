/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureResource, AzureSubscription, ResourceBase, ResourceProvider, WorkspaceResource, WorkspaceResourceProvider } from '../../api/src/index';
import { AzureResourceProvider } from '../hostapi.v2.internal';

export function isArray<T>(maybeArray: T[] | null | undefined): maybeArray is T[] {
    return Array.isArray(maybeArray);
}

class ResourceProviderManager<TResourceSource, TResource extends ResourceBase, TResourceProvider extends ResourceProvider<TResourceSource, TResource>> extends vscode.Disposable {
    private readonly onDidChangeResourceEventEmitter = new vscode.EventEmitter<TResource | undefined>();
    private readonly providers = new Map<TResourceProvider, { listener: vscode.Disposable | undefined }>();

    private isActivating = false;

    public readonly onDidChangeResourceChange: vscode.Event<TResource | undefined>;

    get hasResourceProviders(): boolean {
        return this.providers.size > 0;
    }

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

    async getResources(source: TResourceSource): Promise<TResource[]> {
        await this.activateExtensions();

        const resourceProviders = Array.from(this.providers.keys());

        const resources = await Promise.all(resourceProviders.map(resourceProvider => resourceProvider.getResources(source)));

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

// NOTE: TS doesn't seem to like exporting a type alias (i.e. you cannot instantiate it),
//       so we still have to extend the class.

export class AzureResourceProviderManager extends ResourceProviderManager<AzureSubscription, AzureResource, AzureResourceProvider> {
}

export class WorkspaceResourceProviderManager extends ResourceProviderManager<void, WorkspaceResource, WorkspaceResourceProvider> {
}
