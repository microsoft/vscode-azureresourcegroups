/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeDataProvider, AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import { Disposable, TreeView } from 'vscode';
import { AppResourceResolver, AzureResourceGroupsExtensionApi } from '../api';

export class InternalAzureResourceGroupsExtensionApi implements AzureResourceGroupsExtensionApi {
    #tree: AzExtTreeDataProvider;
    #treeView: TreeView<AzExtTreeItem>;
    #apiVersion: string;
    #revealTreeItem: (resourceId: string) => Promise<void>;
    #registerApplicationResourceResolver: (id: string, resolver: AppResourceResolver) => Disposable;

    public constructor(options: AzureResourceGroupsExtensionApi) {
        this.#tree = options.tree;
        this.#treeView = options.treeView;
        this.#apiVersion = options.apiVersion;
        this.#revealTreeItem = options.revealTreeItem;
        this.#registerApplicationResourceResolver = options.registerApplicationResourceResolver;
    }

    public get tree(): AzExtTreeDataProvider {
        return this.#tree;
    }

    public get treeView(): TreeView<AzExtTreeItem> {
        return this.#treeView;
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
}
