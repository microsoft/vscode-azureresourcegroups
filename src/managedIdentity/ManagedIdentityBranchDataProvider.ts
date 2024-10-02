/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AuthorizationManagementClient, RoleAssignment } from '@azure/arm-authorization';
import { uiUtils } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, createSubscriptionContext, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureResource, type AzureResourceBranchDataProvider } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { localize } from 'vscode-nls';
import { ext } from '../extensionVariables';
import { ResourceGroupsItem } from '../tree/ResourceGroupsItem';
import { ManagedIdentityItem } from './ManagedIdentityItem';
export class ManagedIdentityBranchDataProvider extends vscode.Disposable implements AzureResourceBranchDataProvider<ResourceGroupsItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ResourceGroupsItem | undefined>();
    public roleAssignmentsTask: Promise<{ [id: string]: RoleAssignment[] }>;

    constructor() {
        super(
            () => {
                this.onDidChangeTreeDataEmitter.dispose();
            });
        this.roleAssignmentsTask = this.initialize();
    }

    get onDidChangeTreeData(): vscode.Event<ResourceGroupsItem | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    public async initialize(): Promise<{ [id: string]: RoleAssignment[] }> {
        const provider = await ext.subscriptionProviderFactory();
        const subscriptions = await provider.getSubscriptions(false);
        const roleAssignments: { [id: string]: RoleAssignment[] } = {};
        await Promise.allSettled(subscriptions.map(async (subscription) => {
            const subContext = createSubscriptionContext(subscription);
            const authClient = new AuthorizationManagementClient(subContext.credentials, subContext.subscriptionId);
            roleAssignments[subscription.subscriptionId] = await uiUtils.listAllIterator(authClient.roleAssignments.listForSubscription());
        }));

        return roleAssignments;
    }

    async getChildren(element: ResourceGroupsItem): Promise<ResourceGroupsItem[] | null | undefined> {
        return (await element.getChildren?.())?.map((child) => {
            if (child.id) {
                return ext.azureTreeState.wrapItemInStateHandling(child, () => this.refresh(child))
            }

            return child;
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

        return ext.azureTreeState.wrapItemInStateHandling(resourceItem, () => this.refresh(resourceItem));
    }

    async getTreeItem(element: ResourceGroupsItem): Promise<vscode.TreeItem> {
        return await element.getTreeItem();
    }

    refresh(element?: ResourceGroupsItem): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
