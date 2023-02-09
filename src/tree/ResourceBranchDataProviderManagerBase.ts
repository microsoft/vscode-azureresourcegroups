/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { BranchDataProvider, ResourceBase, ResourceModelBase } from '../../api/src/index';
import { wrapFunctionsInTelemetry } from '../utils/wrapFunctionsInTelemetry';

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
                provider: wrapBranchDataProvider(provider, type),
                listener: provider.onDidChangeTreeData?.(e => this.onDidChangeTreeDataEmitter.fire(e))
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

function wrapBranchDataProvider<TBranchDataProvider extends BranchDataProvider<ResourceBase, ResourceModelBase>, TResourceType>(branchDataProvider: TBranchDataProvider, type: TResourceType): TBranchDataProvider {
    return {
        ...wrapFunctionsInTelemetry(
            {
                getChildren: branchDataProvider.getChildren.bind(branchDataProvider) as typeof branchDataProvider.getChildren,
                getTreeItem: branchDataProvider.getTreeItem.bind(branchDataProvider) as typeof branchDataProvider.getResourceItem,
                getResourceItem: async (element: ResourceBase) => {
                    const result = await branchDataProvider.getResourceItem(element);
                    if (!result) {
                        throw new NullishGetResourceItemResultError(result);
                    }
                    return result;
                },
                getParent: branchDataProvider.getParent?.bind(branchDataProvider) as typeof branchDataProvider.getChildren,
            },
            {
                callbackIdPrefix: 'branchDataProvider.',
                beforeHook: (context: IActionContext) => {
                    context.telemetry.properties.branchDataProviderType = String(type);
                }
            }
        ),
        onDidChangeTreeData: branchDataProvider.onDidChangeTreeData?.bind(branchDataProvider) as typeof branchDataProvider.onDidChangeTreeData,
        resolveTreeItem: branchDataProvider.resolveTreeItem?.bind(branchDataProvider) as typeof branchDataProvider.resolveTreeItem,
    } as BranchDataProvider<ResourceBase, ResourceModelBase> as TBranchDataProvider;
}

class NullishGetResourceItemResultError extends Error {
    constructor(result: never) {
        super(`Internal error: getResourceItem returned ${String(result)}. Expected a non-nullish value.`);
        this.name = 'NullishGetResourceItemResultError';
    }
}
