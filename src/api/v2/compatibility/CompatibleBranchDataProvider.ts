/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeDataProvider, AzExtTreeItem, IFindTreeItemContext, ISubscriptionContext, ITreeItemPickerContext } from '@microsoft/vscode-azext-utils';
import type { AppResource, AppResourceResolver } from '@microsoft/vscode-azext-utils/hostapi';
import * as vscode from 'vscode';
import type { ApplicationResource, BranchDataProvider, ResourceModelBase } from '../../../api/v2/v2AzureResourcesApi';
import { createSubscriptionContext } from '../../../utils/v2/credentialsUtils';
import { CompatibleResolvedApplicationResourceTreeItem } from './CompatibleApplicationResourceTreeItem';

/**
 * Provides compatibility between an `AppResourceResolver` (v1) and a `BranchDataProvider` (v2)
 */
export class CompatibleBranchDataProvider<TResource extends ApplicationResource, TModel extends AzExtTreeItem & ResourceModelBase> extends AzExtTreeDataProvider implements BranchDataProvider<TResource, TModel> {
    private readonly overrideOnDidChangeTreeDataEmitter = new vscode.EventEmitter<TModel | undefined>();

    public constructor(private readonly resolver: AppResourceResolver, loadMoreCommandId: string) {
        // Using `{}` here so property assignment doesn't throw
        super({} as unknown as AzExtParentTreeItem, loadMoreCommandId);
    }

    //#region TreeDataProvider

    // @ts-expect-error overriding a property with an accessor
    public override get onDidChangeTreeData(): vscode.Event<TModel | undefined> {
        return this.overrideOnDidChangeTreeDataEmitter.event;
    }

    public override set onDidChangeTreeData(_: vscode.Event<TModel | undefined>) {
        // Do nothing
    }

    // @ts-expect-error `getParent` is not meant to be defined by `BranchDataProvider`s but is already defined by `AzExtTreeDataProvider`
    public override getParent(_treeItem: TModel): Promise<TModel> {
        throw new Error('Use the Resources extension API to do getParent');
    }

    public override getChildren(treeItem: TModel & AzExtParentTreeItem): Promise<TModel[]> {
        // This method is redeclared to make TypeScript happier, but it's no more than a super call with extra casts
        return super.getChildren(treeItem) as Promise<TModel[]>;
    }

    //#endregion

    //#region BranchDataProvider

    public async getResourceItem(element: TResource): Promise<TModel> {
        const oldAppResource: AppResource = {
            ...element,
            type: element.type.type,
            kind: element.type.kinds?.join(';'),
        };
        const subscriptionContext: ISubscriptionContext = createSubscriptionContext(element.subscription);

        const resolved = await this.resolver.resolveResource(subscriptionContext, oldAppResource);
        return CompatibleResolvedApplicationResourceTreeItem.Create(oldAppResource, resolved!, subscriptionContext, this, element) as unknown as TModel;
    }

    //#endregion BranchDataProvider

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
}
