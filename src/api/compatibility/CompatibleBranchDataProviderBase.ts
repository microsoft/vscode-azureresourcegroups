/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeDataProvider, AzExtTreeItem, IFindTreeItemContext, ITreeItemPickerContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { BranchDataProvider, ResourceBase, ResourceModelBase } from "../../../api/src/index";

export abstract class CompatibleBranchDataProviderBase<TResource extends ResourceBase, TModel extends AzExtTreeItem & ResourceModelBase> extends AzExtTreeDataProvider implements BranchDataProvider<TResource, TModel>, vscode.Disposable {
    protected readonly overrideOnDidChangeTreeDataEmitter = new vscode.EventEmitter<TModel | undefined>();

    public constructor(loadMoreCommandId: string) {
        // Using `{}` here so property assignment doesn't throw
        super({} as unknown as AzExtParentTreeItem, loadMoreCommandId);
    }

    abstract getResourceItem(element: TResource): TModel | Thenable<TModel>;

    //#region TreeDataProvider

    // @ts-expect-error overriding a property with an accessor
    public override get onDidChangeTreeData(): vscode.Event<TModel | undefined> {
        return this.overrideOnDidChangeTreeDataEmitter.event;
    }

    public override set onDidChangeTreeData(_: vscode.Event<TModel | undefined>) {
        // Do nothing
    }

    public override getParent(treeItem: TModel): Promise<TModel | undefined> {
        return Promise.resolve(treeItem.parent as unknown as TModel);
    }

    public override async getChildren(treeItem: TModel & AzExtParentTreeItem): Promise<TModel[]> {
        // This method is redeclared to make TypeScript happier, but it's no more than a super call with extra casts
        return super.getChildren(treeItem) as Promise<TModel[]>;
    }

    //#endregion

    //#region AzExtTreeDataProvider

    public override refreshUIOnly(treeItem?: TModel): void {
        // Override the default behavior to remain scoped to specific elements, like it ought
        // And also, use overrideOnDidChangeTreeDataEmitter
        this.overrideOnDidChangeTreeDataEmitter.fire(treeItem);
    }

    public override async showTreeItemPicker<T extends AzExtTreeItem>(expectedContextValues: string | RegExp | (string | RegExp)[], context: ITreeItemPickerContext & { canPickMany: true; }, startingTreeItem?: AzExtTreeItem): Promise<T[]>;
    public override async showTreeItemPicker<T extends AzExtTreeItem>(_expectedContextValues: string | RegExp | (string | RegExp)[], _context: ITreeItemPickerContext, _startingTreeItem?: AzExtTreeItem): Promise<T> {
        throw new Error('Use the Resources extension API to do showTreeItemPicker');
    }

    public override async findTreeItem<T extends AzExtTreeItem>(_fullId: string, _context: IFindTreeItemContext): Promise<T | undefined> {
        throw new Error('Use the Resources extension API to do findTreeItem');
    }

    // TODO: this (probably?) shouldn't remain in the code we release, but will be helpful in testing to ensure we never access the root
    // @ts-expect-error TypeScript is unhappy that we're overriding something that it doesn't know is secretly on the base class
    private override get _rootTreeItem(): AzExtParentTreeItem {
        throw new Error('The root tree item should not be accessed in a BranchDataProvider');
    }

    // This is assigned to in the constructor of AzExtTreeDataProvider
    // @ts-expect-error TypeScript is unhappy that we're overriding something that it doesn't know is secretly on the base class
    private override set _rootTreeItem(_value: AzExtParentTreeItem) {
        // Do nothing!
    }

    //#endregion AzExtTreeDataProvider

    public dispose(): void {
        super.dispose();
        this.overrideOnDidChangeTreeDataEmitter.dispose();
    }
}
