/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeDataProvider, AzExtTreeItem, contextValueExperience, findByIdExperience, IActionContext, IFindTreeItemContext, isWrapper, ITreeItemPickerContext } from "@microsoft/vscode-azext-utils";
import { Disposable, Event, TreeDataProvider, TreeItem, TreeView } from "vscode";
import { ResourceGroupsItem } from "../../../tree/v2/ResourceGroupsItem";

/**
 * An intermediate class that exists just to redeclare several events as abstract, so they
 * can be re-redeclared as a accessors in {@link AzExtTreeDataProviderLike} below
 */
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

    public override async findTreeItem<T>(fullId: string, context: IFindTreeItemContext): Promise<T | undefined> {
        // Special handling for subscription tree item
        // Use the new finder experience
        // Unbox the item at the end

        const result = await findByIdExperience(context, this.tdp, fullId);
        return isWrapper(result) ? result.unwrap<T>() : result as unknown as T;
    }

    public override showTreeItemPicker<T>(expectedContextValues: string | RegExp | (string | RegExp)[], context: ITreeItemPickerContext & { canPickMany: true }, startingTreeItem?: AzExtTreeItem): Promise<T[]>;
    public override async showTreeItemPicker<T>(expectedContextValues: string | RegExp | (string | RegExp)[], context: ITreeItemPickerContext, _startingTreeItem?: AzExtTreeItem): Promise<T> {

        // Special handling for subscription tree item
        // Use the new finder experience
        // Unbox the item at the end

        // TODO: support startingTreeItem

        const result = await contextValueExperience(context, this.tdp, {
            include: expectedContextValues,
        });

        return isWrapper(result) ? result.unwrap<T>() : result as unknown as T;
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
