/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeDataProvider, AzExtTreeItem, ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import { Activity, AppResourceResolver, AzureHostExtensionApi, AzureResourceGroupsExtensionApi, LocalResourceProvider, PickAppResourceOptions, WorkspaceResourceProvider } from '@microsoft/vscode-azext-utils/hostapi';
import { Disposable, TreeView } from 'vscode';

export class InternalAzureResourceGroupsExtensionApi implements AzureHostExtensionApi, AzureResourceGroupsExtensionApi {
    public static apiVersion = '0.0.1';

    #appResourceTree: AzExtTreeDataProvider;
    #appResourceTreeView: TreeView<unknown>;
    #workspaceResourceTree: AzExtTreeDataProvider;
    #workspaceResourceTreeView: TreeView<unknown>;
    #apiVersion: string;
    #registerApplicationResourceResolver: (id: string, resolver: AppResourceResolver) => Disposable;
    #registerWorkspaceResourceProvider: (id: string, resolver: WorkspaceResourceProvider) => Disposable;
    #registerActivity: (activity: Activity) => Promise<void>;
    #pickAppResource: <T extends AzExtTreeItem>(context: ITreeItemPickerContext, options?: PickAppResourceOptions) => Promise<T>;

    // This `Omit` is here because the interface expects those keys to be defined, but in this object they will not be
    // They are replaced with functions defined on this class that merely wrap the newly-named keys
    // TODO: when `tree`, `treeView`, and `registerLocalResourceProvider` are removed from the interface, this `Omit` can be removed
    public constructor(options: Omit<AzureHostExtensionApi, 'tree' | 'treeView' | 'registerLocalResourceProvider'>) {
        this.#appResourceTree = options.appResourceTree;
        this.#appResourceTreeView = options.appResourceTreeView;
        this.#workspaceResourceTree = options.workspaceResourceTree;
        this.#workspaceResourceTreeView = options.workspaceResourceTreeView;
        this.#apiVersion = options.apiVersion;
        this.#registerApplicationResourceResolver = options.registerApplicationResourceResolver;
        this.#registerWorkspaceResourceProvider = options.registerWorkspaceResourceProvider;
        this.#registerActivity = options.registerActivity;
        this.#pickAppResource = options.pickAppResource;
    }

    public get appResourceTree(): AzExtTreeDataProvider {
        return this.#appResourceTree;
    }

    public get appResourceTreeView(): TreeView<unknown> {
        return this.#appResourceTreeView;
    }

    public get workspaceResourceTree(): AzExtTreeDataProvider {
        return this.#workspaceResourceTree;
    }

    public get workspaceResourceTreeView(): TreeView<unknown> {
        return this.#workspaceResourceTreeView;
    }

    public get apiVersion(): string {
        return this.#apiVersion;
    }

    public async pickAppResource<T extends AzExtTreeItem>(context: ITreeItemPickerContext, options?: PickAppResourceOptions): Promise<T> {
        return this.#pickAppResource(context, options);
    }

    public registerApplicationResourceResolver(id: string, resolver: AppResourceResolver): Disposable {
        return this.#registerApplicationResourceResolver(id, resolver);
    }

    public registerWorkspaceResourceProvider(id: string, resolver: WorkspaceResourceProvider): Disposable {
        return this.#registerWorkspaceResourceProvider(id, resolver);
    }

    public async registerActivity(activity: Activity): Promise<void> {
        return this.#registerActivity(activity);
    }

    //#region Deprecated things that will be removed soon

    public get tree(): AzExtTreeDataProvider {
        return this.appResourceTree;
    }

    public get treeView(): TreeView<unknown> {
        return this.appResourceTreeView;
    }

    public registerLocalResourceProvider(id: string, provider: LocalResourceProvider): Disposable {
        return this.registerWorkspaceResourceProvider(id, provider);
    }

    //#endregion
}
