/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as vscode from 'vscode';
import { BranchDataProvider, ResourceBase, ResourceModelBase } from '../api/public';

export abstract class ResourceBranchDataProviderManagerBase<TResourceType, TBranchDataProvider extends BranchDataProvider<ResourceBase, ResourceModelBase>> extends vscode.Disposable {
    private readonly branchDataProviderMap = new Map<TResourceType, { provider: TBranchDataProvider, listener: vscode.Disposable | undefined }>();
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceModelBase | ResourceModelBase[] | undefined | null>();
    private readonly onDidChangeBranchDataProvidersEmitter = new vscode.EventEmitter<TResourceType>()

    constructor(
        private readonly defaultProvider: TBranchDataProvider,
        private readonly extensionActivator: (type: TResourceType) => void
    ) {
        super(
            () => {
                this.onDidChangeTreeDataEmitter.dispose();
                this.onDidChangeBranchDataProvidersEmitter.dispose();

                for (const providerContext of this.branchDataProviderMap.values()) {
                    providerContext.listener?.dispose();
                }
            });
    }

    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    public readonly onChangeBranchDataProviders: vscode.Event<TResourceType> = this.onDidChangeBranchDataProvidersEmitter.event;

    addProvider(type: TResourceType, provider: TBranchDataProvider): void {
        this.branchDataProviderMap.set(
            type,
            {
                provider,
                listener: provider.onDidChangeTreeData?.((e) => {
                    if (e) {
                        this.onDidChangeTreeDataEmitter.fire(e);
                    } else {
                        // scope a change event to the specific branch data provider
                        this.onDidChangeBranchDataProvidersEmitter.fire(type);
                    }
                }),
            }
        );

        this.onDidChangeBranchDataProvidersEmitter.fire(type);
    }

    getProvider(type: TResourceType | undefined): TBranchDataProvider {
        if (type) {
            const providerContext = this.branchDataProviderMap.get(type);

            if (providerContext) {
                return providerContext.provider;
            }

            // NOTE: The default branch data provider will be returned until the extension is loaded.
            //       The extension will then register its branch data providers, resulting in a change event.
            //       The tree will then be refreshed, resulting in this method being called again.
            this.extensionActivator(type);
        }

        return this.defaultProvider;
    }

    removeProvider(type: TResourceType): void {
        const providerContext = this.branchDataProviderMap.get(type);

        if (providerContext) {
            providerContext.listener?.dispose();

            this.branchDataProviderMap.delete(type);
            this.onDidChangeBranchDataProvidersEmitter.fire(type);
        }
    }
}
