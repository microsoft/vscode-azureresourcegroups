/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, TreeElementBase, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzureResource, AzureResourceModel, BranchDataProvider } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { localize } from 'vscode-nls';
import { ext } from '../extensionVariables';
import { ResourceGroupsItem } from '../tree/ResourceGroupsItem';
import { ManagedIdentityItem } from './ManagedIdentityItem';
export class ManagedIdentityBranchDataProvider extends vscode.Disposable implements BranchDataProvider<AzureResource, AzureResourceModel> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeElementBase | undefined>();

    constructor() {
        super(
            () => {
                this.onDidChangeTreeDataEmitter.dispose();
            });
    }

    get onDidChangeTreeData(): vscode.Event<TreeElementBase | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    async getChildren(element: ResourceGroupsItem): Promise<TreeElementBase[] | null | undefined> {
        return (await element.getChildren?.())?.map((child) => {
            return ext.azureTreeState.wrapItemInStateHandling(child, () => this.refresh(child))
        });
    }

    async getResourceItem(element: AzureResource): Promise<ResourceGroupsItem> {
        const resourceItem = await callWithTelemetryAndErrorHandling(
            'getResourceItem',
            async (context: IActionContext) => {
                context.errorHandling.rethrow = true;
                return new ManagedIdentityItem(element.subscription, element);
            });

        if (!resourceItem) {
            throw new Error(localize('failedToGetResourceItem', 'Failed to get resource item for "{0}"', element.id));
        }

        return ext.azureTreeState.wrapItemInStateHandling(resourceItem, () => this.refresh(resourceItem)) as ResourceGroupsItem;
    }

    async getTreeItem(element: ResourceGroupsItem): Promise<vscode.TreeItem> {
        return await element.getTreeItem();
    }

    refresh(element?: TreeElementBase): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
