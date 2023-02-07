/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SubscriptionTreeItemBase } from "@microsoft/vscode-azext-azureutils";
import { AzExtParentTreeItem, AzExtTreeDataProvider, AzExtTreeItem, IActionContext, isAzExtParentTreeItem, ITreeItemPickerContext, PickTreeItemWithCompatibility } from "@microsoft/vscode-azext-utils";
import { Disposable, Event, TreeItem, TreeView } from "vscode";
import { isWrapper } from "../../../api/src/index";
import { ResourceTreeDataProviderBase } from "../../tree/ResourceTreeDataProviderBase";
import { CompatibleAzureAccountTreeItem } from "./CompatibleAzureAccountTreeItem";

/**
 * An intermediate class that exists just to redeclare several events as abstract, so they
 * can be re-redeclared as a accessors in {@link CompatibleAzExtTreeDataProvider} below
 */
abstract class IntermediateCompatibleAzExtTreeDataProvider extends AzExtTreeDataProvider {
    public abstract onDidChangeTreeData: Event<AzExtTreeItem | undefined>;
    public abstract onTreeItemCreate: Event<AzExtTreeItem>;
    public abstract onDidExpandOrRefreshExpandedTreeItem: Event<AzExtTreeItem>;
}

/**
 * Used for v1 API `api.appResourceTree` and `api.workspaceResourceTree` in place of `AzExtTreeDataProvider`.
 */
export class CompatibleAzExtTreeDataProvider extends IntermediateCompatibleAzExtTreeDataProvider {
    public constructor(private readonly tdp: ResourceTreeDataProviderBase) {
        super(new CompatibleAzureAccountTreeItem(), undefined as unknown as string);
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

    public override getChildren(treeItem?: AzExtParentTreeItem): Promise<AzExtTreeItem[]> {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return this.tdp.getChildren(treeItem);
    }

    public override async findTreeItem<T>(fullId: string): Promise<T | undefined> {
        const result = await this.tdp.findItemById(fullId);
        return isWrapper(result) ? result.unwrap<T>() : result as unknown as T;
    }

    public override showTreeItemPicker<T extends AzExtTreeItem>(expectedContextValues: string | RegExp | (string | RegExp)[], context: ITreeItemPickerContext & { canPickMany: true }, startingTreeItem?: AzExtTreeItem): Promise<T[]>;
    public override async showTreeItemPicker<T extends AzExtTreeItem>(expectedContextValues: string | RegExp | (string | RegExp)[], context: ITreeItemPickerContext, _startingTreeItem?: AzExtTreeItem): Promise<T> {
        if (expectedContextValues === SubscriptionTreeItemBase.contextValue) {
            const subscriptionContext = await PickTreeItemWithCompatibility.subscription(context, this.tdp);
            const ti = { subscription: subscriptionContext };
            return ti as unknown as T;
        }

        return PickTreeItemWithCompatibility.showTreeItemPicker<T>(context, this.tdp, expectedContextValues, _startingTreeItem);
    }

    public override refresh(_context: IActionContext, treeItem?: AzExtTreeItem | undefined): Promise<void> {
        if (isAzExtParentTreeItem(treeItem)) {
            // Flush the cache at and below the given treeItem
            (treeItem as unknown as { clearCache(): void }).clearCache();
        }
        // Trigger a refresh at the given treeItem
        this.tdp.notifyTreeDataChanged(treeItem);
        return Promise.resolve();
    }

    public override refreshUIOnly(treeItem: AzExtTreeItem | undefined): void {
        this.tdp.notifyTreeDataChanged(treeItem);
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
