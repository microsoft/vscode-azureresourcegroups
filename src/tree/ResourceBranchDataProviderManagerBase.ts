/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, parseError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { BranchDataProvider, ResourceBase, ResourceModelBase, ResourceTreeOperationContext } from '../../api/src/index';
import { wrapFunctionsInTelemetry } from '../utils/wrapFunctionsInTelemetry';
import { ext } from '../extensionVariables';
import { localize } from '../utils/localize';

export abstract class ResourceBranchDataProviderManagerBase<TResourceType, TBranchDataProvider extends BranchDataProvider<ResourceBase, ResourceModelBase>> extends vscode.Disposable {
    private readonly branchDataProviderMap = new Map<TResourceType, { provider: TBranchDataProvider, listener: vscode.Disposable | undefined }>();
    private readonly activations = new Map<TResourceType, Promise<void>>();
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | ResourceModelBase | ResourceModelBase[] | undefined | null>();
    private readonly onDidChangeBranchDataProvidersEmitter = new vscode.EventEmitter<TResourceType>();

    constructor(
        private readonly defaultProvider: TBranchDataProvider,
        private readonly extensionActivator: (type: TResourceType) => void | Promise<void>
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
            void this.activateProvider(type);
        }

        return this.defaultProvider;
    }

    async getProviderForReveal(type: TResourceType | undefined): Promise<TBranchDataProvider> {
        if (type) {
            const pending = this.activations.get(type);
            if (pending) {
                await pending;
            } else if (!this.branchDataProviderMap.has(type)) {
                await this.activateProvider(type);
            }
            return this.branchDataProviderMap.get(type)?.provider ?? this.defaultProvider;
        }
        return this.defaultProvider;
    }

    private activateProvider(type: TResourceType): Promise<void> {
        const pending = this.activations.get(type);
        if (pending) {
            return pending;
        }
        const activation = Promise.resolve().then(() => this.extensionActivator(type));
        this.activations.set(type, activation);
        // Observe lazy-activation failures without consuming the rejection awaited by explicit reveals.
        void activation.then(
            () => { this.activations.delete(type); },
            error => {
                this.activations.delete(type);
                ext.outputChannel?.appendLog(localize('branchProviderActivationFailed',
                    'Unable to activate the resource extension: {0}', parseError(error).message));
            });
        return activation;
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
                getTreeItem: branchDataProvider.getTreeItem.bind(branchDataProvider),
                getResourceItem: async (element: ResourceBase, context?: ResourceTreeOperationContext) => {
                    const result = await branchDataProvider.getResourceItem(element, context);
                    if (!result) {
                        throw new NullishGetResourceItemResultError(result);
                    }
                    return result;
                },
                getParent: branchDataProvider.getParent?.bind(branchDataProvider) as typeof branchDataProvider.getChildren,
            },
            {
                callbackIdPrefix: 'branchDataProvider.',
                propagateErrors: args => {
                    const context = args[1];
                    return !!context && typeof context === 'object'
                        && 'propagateErrors' in context && context.propagateErrors === true;
                },
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
