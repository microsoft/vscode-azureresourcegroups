/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeDataProvider, AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import { Activity, AppResourceResolver, AzureResourceGroupsExtensionApi, LocalResourceProvider, WorkspaceResourceProvider } from '@microsoft/vscode-azext-utils/rgapi';
import { Disposable, TreeView } from 'vscode';

export class InternalAzureResourceGroupsExtensionApi implements AzureResourceGroupsExtensionApi {
    #appResourceTree: AzExtTreeDataProvider;
    #appResourceTreeView: TreeView<AzExtTreeItem>;
    #workspaceResourceTree: AzExtTreeDataProvider;
    #workspaceResourceTreeView: TreeView<AzExtTreeItem>;
    #apiVersion: string;
    #revealTreeItem: (resourceId: string) => Promise<void>;
    #registerApplicationResourceResolver: (id: string, resolver: AppResourceResolver) => Disposable;
    #registerWorkspaceResourceProvider: (id: string, resolver: WorkspaceResourceProvider) => Disposable;
    #registerActivity: (activity: Activity) => Promise<void>;

    // This `omit` is here because the interface expects those keys to be defined, but in this object they will not be
    // They are replaced with functions defined on this class that merely wrap the newly-named keys
    public constructor(options: Omit<AzureResourceGroupsExtensionApi, 'tree' | 'treeView' | 'registerLocalResourceProvider'>) {
        this.#appResourceTree = options.appResourceTree;
        this.#appResourceTreeView = options.appResourceTreeView;
        this.#apiVersion = options.apiVersion;
        this.#revealTreeItem = options.revealTreeItem;
        this.#registerApplicationResourceResolver = options.registerApplicationResourceResolver;
        this.#registerWorkspaceResourceProvider = options.registerWorkspaceResourceProvider;
        this.#registerActivity = options.registerActivity;
    }

    public get appResourceTree(): AzExtTreeDataProvider {
        return this.#appResourceTree;
    }

    public get appResourceTreeView(): TreeView<AzExtTreeItem> {
        return this.#appResourceTreeView;
    }

    public get workspaceResourceTree(): AzExtTreeDataProvider {
        return this.#workspaceResourceTree;
    }

    public get workspaceResourceTreeView(): TreeView<AzExtTreeItem> {
        return this.#workspaceResourceTreeView;
    }

    public get apiVersion(): string {
        return this.#apiVersion;
    }

    public async revealTreeItem(resourceId: string): Promise<void> {
        return await this.#revealTreeItem(resourceId);
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

    public get treeView(): TreeView<AzExtTreeItem> {
        return this.appResourceTreeView;
    }

    public registerLocalResourceProvider(id: string, provider: LocalResourceProvider): Disposable {
        return this.registerWorkspaceResourceProvider(id, provider);
    }

    //#endregion
}
