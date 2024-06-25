/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { TenantIdDescription } from '@azure/arm-resources-subscriptions';
import { AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { nonNullProp, nonNullValueAndProp } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { TenantResourceProviderManager } from '../../api/ResourceProviderManagers';
import { ext } from '../../extensionVariables';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { GenericItem } from '../GenericItem';
import { OnGetChildrenBase, getAzureSubscriptionProvider } from '../OnGetChildrenBase';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from "../ResourceTreeDataProviderBase";
import { TreeItemStateStore } from '../TreeItemState';
import { TenantResourceBranchDataProviderManager } from "./TenantResourceBranchDataProviderManager";
import { TenantTreeItem } from './TenantTreeItem';

export class TenantResourceTreeDataProvider extends ResourceTreeDataProviderBase {
    public subscriptionProvider: AzureSubscriptionProvider | undefined;
    public statusSubscription: vscode.Disposable | undefined;

    constructor(
        protected readonly branchDataProviderManager: TenantResourceBranchDataProviderManager,
        onRefresh: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
        protected readonly resourceProviderManager: TenantResourceProviderManager,
        state: TreeItemStateStore,
        branchItemCache: BranchDataItemCache,
        callOnDispose?: () => void) {
        super(
            branchItemCache,
            branchDataProviderManager.onDidChangeTreeData,
            resourceProviderManager.onDidChangeResourceChange,
            onRefresh,
            state,
            () => {
                this.statusSubscription?.dispose();
                callOnDispose?.();
            });
    }

    async onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        if (element) {
            return await element.getChildren();
        } else {
            const subscriptionProvider = await getAzureSubscriptionProvider(this);
            const children: ResourceGroupsItem[] = await OnGetChildrenBase(subscriptionProvider);

            if (children.length === 0) {
                const session = await vscode.authentication.getSession('microsoft', ['https://management.azure.com/.default']); // Will not work for sovereign clouds
                const tenants: TenantIdDescription[] = await subscriptionProvider.getTenants();
                const tenantItems: ResourceGroupsItem[] = []
                for await (const tenant of tenants) {
                    const isSignedIn = await subscriptionProvider.isSignedIn(nonNullProp(tenant, 'tenantId'));
                    tenantItems.push(new TenantTreeItem(nonNullProp(tenant, 'displayName'), nonNullProp(tenant, 'tenantId'), {
                        contextValue: isSignedIn ? 'tenantName' : 'tenantNameNotSignedIn',
                        checkboxState: (!(isSignedIn) || this.checkUnselectedTenants(nonNullProp(tenant, 'tenantId'))) ?
                            vscode.TreeItemCheckboxState.Unchecked : vscode.TreeItemCheckboxState.Checked, // Make sure tenants which are not signed in are unchecked
                        description: tenant.defaultDomain
                    }));
                }

                children.push(new GenericItem(nonNullValueAndProp(session?.account, 'label'), {
                    children: tenantItems,
                    iconPath: new vscode.ThemeIcon('account'),
                    contextValue: 'accountName'
                }));
            }
            return children;
        }
    }

    private checkUnselectedTenants(tenantId: string): boolean {
        const settings = ext.context.globalState.get<string[]>('unselectedTenants');
        if (settings) {
            if (settings.includes(tenantId)) {
                return true;
            }
        }
        return false;
    }
}
