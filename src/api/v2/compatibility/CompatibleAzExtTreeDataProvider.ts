/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeDataProvider, AzExtTreeItem, compatibilitySubscriptionExperience, contextValueExperience, findByIdExperience, IActionContext, IFindTreeItemContext, isWrapper, ITreeItemPickerContext } from "@microsoft/vscode-azext-utils";
import { Disposable, Event, TreeItem, TreeView } from "vscode";
import { SubscriptionTreeItem } from "../../../tree/SubscriptionTreeItem";
import { ResourceGroupsItem } from "../../../tree/v2/ResourceGroupsItem";
import { ResourceTreeDataProviderBase } from "../../../tree/v2/ResourceTreeDataProviderBase";

/**
 * An intermediate class that exists just to redeclare several events as abstract, so they
 * can be re-redeclared as a accessors in {@link CompatibleAzExtTreeDataProvider} below
 */
abstract class IntermediateCompatibleAzExtTreeDataProvider extends AzExtTreeDataProvider {
    public abstract onDidChangeTreeData: Event<AzExtTreeItem | undefined>;
    public abstract onTreeItemCreate: Event<AzExtTreeItem>;
    public abstract onDidExpandOrRefreshExpandedTreeItem: Event<AzExtTreeItem>;
}

export class CompatibleAzExtTreeDataProvider extends IntermediateCompatibleAzExtTreeDataProvider {
    public constructor(private readonly tdp: ResourceTreeDataProviderBase) {
        super({} as unknown as AzExtParentTreeItem, undefined as unknown as string);
    }

    public override getParent(treeItem: AzExtTreeItem): Promise<AzExtTreeItem | undefined> {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return this.tdp.getParent(treeItem);
    }

    public override getTreeItem(treeItem: AzExtTreeItem): TreeItem {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return this.tdp.getTreeItem(treeItem);
    }

    public override getChildren(_treeItem?: AzExtParentTreeItem): Promise<AzExtTreeItem[]> {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return this.tdp.getChildren(_treeItem);
    }

    public override async findTreeItem<T>(fullId: string, context: IFindTreeItemContext): Promise<T | undefined> {
        // Special handling for subscription tree item
        // Use the new finder experience
        // Unbox the item at the end

        const result = await findByIdExperience(context, this.tdp, fullId);
        return isWrapper(result) ? result.unwrap<T>() : result as unknown as T;
    }

    public override showTreeItemPicker<T>(expectedContextValues: string | RegExp | (string | RegExp)[], context: ITreeItemPickerContext & { canPickMany: true }, startingTreeItem?: AzExtTreeItem): Promise<T[]>;
    public override async showTreeItemPicker<T>(expectedContextValues: string | RegExp | (string | RegExp)[], context: ITreeItemPickerContext, _startingTreeItem?: AzExtTreeItem): Promise<T> {
        if (expectedContextValues === SubscriptionTreeItem.contextValue) {
            const result = await compatibilitySubscriptionExperience(context, this.tdp);
            const subscription = isWrapper(result) ? result.unwrap<T>() : result as unknown as T;
            return { subscription } as unknown as T;
        }

        // TODO: support startingTreeItem

        const result = await contextValueExperience(context, this.tdp, {
            include: expectedContextValues,
        });

        return isWrapper(result) ? result.unwrap<T>() : result as unknown as T;
    }

    public override refresh(_context: IActionContext, treeItem?: AzExtTreeItem | undefined): Promise<void> {

        // Flush the cache at and below the given treeItem
        // Trigger a refresh at the given treeItem
        this.tdp.onDidChangeTreeDataEmitter.fire(treeItem as unknown as ResourceGroupsItem);

        return Promise.resolve();
    }

    public override refreshUIOnly(treeItem: AzExtTreeItem | undefined): void {

        this.tdp.onDidChangeTreeDataEmitter.fire(treeItem as unknown as ResourceGroupsItem);

    }

    public override loadMore(_treeItem: AzExtTreeItem, _context: IActionContext): Promise<void> {
        // TODO: unknown how this will be implemented?
        throw new Error('TODO: Implement this using the new load more approach');
    }

    //#region Things that should not be called
    public override trackTreeItemCollapsibleState(_treeView: TreeView<AzExtTreeItem>): Disposable {
        throw new ShouldNeverBeCalledError('trackTreeItemCollapsibleState method');
    }

    public get onDidChangeTreeData(): Event<AzExtTreeItem | undefined> {
        throw new ShouldNeverBeCalledError('onDidChangeTreeData accessor');
    }

    public get onTreeItemCreate(): Event<AzExtTreeItem> {
        throw new ShouldNeverBeCalledError('onTreeItemCreate accessor');
    }

    public get onDidExpandOrRefreshExpandedTreeItem(): Event<AzExtTreeItem> {
        throw new ShouldNeverBeCalledError('onDidExpandOrRefreshExpandedTreeItem accessor');
    }
    //#endregion Things that should not be called
}

class ShouldNeverBeCalledError extends Error {
    constructor(methodName: string) {
        super(`${methodName} should never be called.`);
    }
}
