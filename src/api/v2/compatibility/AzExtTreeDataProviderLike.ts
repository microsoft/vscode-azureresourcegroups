/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeDataProvider, AzExtTreeItem, IActionContext, IFindTreeItemContext, ITreeItemPickerContext } from "@microsoft/vscode-azext-utils";
import { Disposable, Event, TreeDataProvider, TreeItem, TreeView } from "vscode";
import { ResourceGroupsItem } from "../../../tree/v2/ResourceGroupsItem";

abstract class IntermediateAzExtTreeDataProviderLike extends AzExtTreeDataProvider {
    public abstract onDidChangeTreeData: Event<AzExtTreeItem | undefined>;
    public abstract onTreeItemCreate: Event<AzExtTreeItem>;
    public abstract onDidExpandOrRefreshExpandedTreeItem: Event<AzExtTreeItem>;
}

export class AzExtTreeDataProviderLike extends IntermediateAzExtTreeDataProviderLike {
    public constructor(private readonly tdp: TreeDataProvider<ResourceGroupsItem>) {
        super(undefined as unknown as AzExtParentTreeItem, undefined as unknown as string);
    }

    //#region Things that should not be called
    public override trackTreeItemCollapsibleState(_treeView: TreeView<AzExtTreeItem>): Disposable {
        throw new Error('This method should never be called');
    }

    public override getParent(_treeItem: AzExtTreeItem): Promise<AzExtTreeItem | undefined> {
        throw new Error('This method should never be called');
    }

    public override getTreeItem(_treeItem: AzExtTreeItem): TreeItem {
        throw new Error('This method should never be called');
    }

    public get onDidChangeTreeData(): Event<AzExtTreeItem | undefined> {
        throw new Error('This accessor should never be called');
    }

    public get onTreeItemCreate(): Event<AzExtTreeItem> {
        throw new Error('This accessor should never be called');
    }

    public get onDidExpandOrRefreshExpandedTreeItem(): Event<AzExtTreeItem> {
        throw new Error('This accessor should never be called');
    }

    public override getChildren(_treeItem?: AzExtParentTreeItem): Promise<AzExtTreeItem[]> {
        throw new Error('This method should never be called'); // TODO: But CosmosDB does currently call it
    }
    //#endregion Things that should not be called

    public override findTreeItem<T extends AzExtTreeItem>(_fullId: string, _context: IFindTreeItemContext): Promise<T | undefined> {
        // Special handling for subscription tree item
        // Use the new finder experience
        // Unbox the item at the end
        throw new Error('TODO: Implement this using the new find approach');
    }

    public override showTreeItemPicker<T extends AzExtTreeItem>(expectedContextValues: string | RegExp | (string | RegExp)[], context: ITreeItemPickerContext & { canPickMany: true }, startingTreeItem?: AzExtTreeItem): Promise<T[]>;
    public override showTreeItemPicker<T extends AzExtTreeItem>(_expectedContextValues: string | RegExp | (string | RegExp)[], _context: ITreeItemPickerContext, _startingTreeItem?: AzExtTreeItem): Promise<T> {
        // Special handling for subscription tree item
        // Use the new finder experience
        // Unbox the item at the end
        throw new Error('TODO: Implement this using the new find approach');
    }

    public override refresh(_context: IActionContext, _treeItem?: AzExtTreeItem | undefined): Promise<void> {
        // Flush the cache at and below the given treeItem
        // Trigger a refresh at the given treeItem
        throw new Error('TODO: Implement this using the new tree');
    }

    public override refreshUIOnly(_treeItem: AzExtTreeItem | undefined): void {
        // Trigger a refresh at the given treeItem
        throw new Error('TODO: Implement this using the new tree');
    }

    public override loadMore(_treeItem: AzExtTreeItem, _context: IActionContext): Promise<void> {
        // TODO: unknown how this will be implemented?
        throw new Error('TODO: Implement this using the new load more approach');
    }
}
