/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeDataProvider, AzExtTreeItem, IFindTreeItemContext, ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import type { WorkspaceResource } from '@microsoft/vscode-azext-utils/hostapi';
import * as vscode from 'vscode';
import type { BranchDataProvider, WorkspaceResource as v2WorkspaceResource } from '../v2AzureResourcesApi';

/**
 * Provides compatibility between an `AppResourceResolver` (v1) and a `BranchDataProvider` (v2)
 */
export class CompatibleWorkspaceResourceBranchDataProvider<TResource extends WorkspaceResource & v2WorkspaceResource> extends AzExtTreeDataProvider implements BranchDataProvider<TResource, TResource> {
    private readonly overrideOnDidChangeTreeDataEmitter = new vscode.EventEmitter<TResource | undefined>();

    public constructor(loadMoreCommandId: string) {
        // Using `{}` here so property assignment doesn't throw
        super({} as unknown as AzExtParentTreeItem, loadMoreCommandId);
    }

    //#region TreeDataProvider

    // @ts-expect-error overriding a property with an accessor
    public override get onDidChangeTreeData(): vscode.Event<TResource | undefined> {
        return this.overrideOnDidChangeTreeDataEmitter.event;
    }

    public override set onDidChangeTreeData(_: vscode.Event<TResource | undefined>) {
        // Do nothing
    }

    // @ts-expect-error `getParent` is not meant to be defined by `BranchDataProvider`s but is already defined by `AzExtTreeDataProvider`
    public override getParent(_treeItem: TResource): Promise<TResource> {
        throw new Error('Use the Resources extension API to do getParent');
    }

    public override getChildren(treeItem: TResource & AzExtParentTreeItem): Promise<TResource[]> {
        // This method is redeclared to make TypeScript happier, but it's no more than a super call with extra casts
        return super.getChildren(treeItem) as Promise<TResource[]>;
    }

    //#endregion

    //#region BranchDataProvider

    public async getResourceItem(element: TResource): Promise<TResource> {
        return element;
    }

    //#endregion BranchDataProvider

    //#region AzExtTreeDataProvider

    public override refreshUIOnly(treeItem?: TResource): void {
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
}
