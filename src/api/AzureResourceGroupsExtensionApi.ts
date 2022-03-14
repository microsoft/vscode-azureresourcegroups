/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeDataProvider, AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import { Disposable, TreeView } from 'vscode';
import { AppResourceResolver, AzureResourceGroupsExtensionApi } from '../api';

export class InternalAzureResourceGroupsExtensionApi implements AzureResourceGroupsExtensionApi {
    readonly tree: AzExtTreeDataProvider;
    readonly treeView: TreeView<AzExtTreeItem>;
    readonly apiVersion: string;
    readonly revealTreeItem: (resourceId: string) => Promise<void>;
    readonly registerApplicationResourceResolver: (id: string, resolver: AppResourceResolver) => Disposable;

    public constructor(options: AzureResourceGroupsExtensionApi) {
        this.tree = options.tree;
        this.treeView = options.treeView;
        this.apiVersion = options.apiVersion;
        this.revealTreeItem = options.revealTreeItem;
        this.registerApplicationResourceResolver = options.registerApplicationResourceResolver;
    }
}
