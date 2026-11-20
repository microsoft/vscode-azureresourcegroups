/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeElementBase } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ResourceModelBase } from '../../../api/src/index';
import { AzureResourceProviderManager } from '../../api/ResourceProviderManagers';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from '../ResourceTreeDataProviderBase';
import { TreeItemStateStore } from '../TreeItemState';
import { AzureResourceGroupingManager } from './grouping/AzureResourceGroupingManager';
import { GroupingItem } from './grouping/GroupingItem';
import { TreeTraversalContext } from '../../utils/treeOperations';

export abstract class AzureResourceTreeDataProviderBase extends ResourceTreeDataProviderBase {
    constructor(
        itemCache: BranchDataItemCache,
        onDidChangeBranchTreeData: vscode.Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined>,
        onRefresh: vscode.Event<void | TreeElementBase | TreeElementBase[] | null | undefined>,
        state: TreeItemStateStore,
        protected readonly resourceGroupingManager: AzureResourceGroupingManager,
        protected readonly resourceProviderManager: AzureResourceProviderManager,
        callOnDispose?: () => void) {
        super(
            itemCache,
            onDidChangeBranchTreeData,
            resourceProviderManager.onDidChangeResourceChange,
            onRefresh,
            state,
            () => {
                this.statusSubscription?.dispose();
                callOnDispose?.();
            });
    }

    abstract onGetChildren(element?: ResourceGroupsItem | undefined, options?: TreeTraversalContext): Promise<ResourceGroupsItem[] | null | undefined>;

    protected override isAncestorOf(element: ResourceGroupsItem, id: string, options?: TreeTraversalContext): boolean {
        if (element instanceof GroupingItem) {
            const resourceId = id.replace(/^\/accounts\/[^/]+\/tenants\/[^/]+(?=\/)/i, '');
            return element.resources.some(resource => resourceId.toLowerCase() === resource.id.toLowerCase()
                || resourceId.toLowerCase().startsWith(resource.id.toLowerCase() + '/'));
        }
        return super.isAncestorOf(element, id, options);
    }
}
