/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzureSubscriptionProvider, getConfiguredAuthProviderId } from '@microsoft/vscode-azext-azureauth';
import { callWithTelemetryAndErrorHandling, IActionContext, nonNullProp, nonNullValueAndProp } from '@microsoft/vscode-azext-utils';
import { ResourceModelBase } from 'api/src';
import * as vscode from 'vscode';
import { TenantResourceProviderManager } from '../../api/ResourceProviderManagers';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { GenericItem } from '../GenericItem';
import { getAzureSubscriptionProvider, OnGetChildrenBase } from '../OnGetChildrenBase';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from "../ResourceTreeDataProviderBase";
import { TenantResourceBranchDataProviderManager } from "./TenantResourceBranchDataProviderManager";
import { TenantTreeItem } from './TenantTreeItem';
import { isTenantFilteredOut } from './registerTenantTree';

export class TenantResourceTreeDataProvider extends ResourceTreeDataProviderBase {
    public subscriptionProvider: AzureSubscriptionProvider | undefined;
    public statusSubscription: vscode.Disposable | undefined;
    public nextSessionChangeMessageMinimumTime = 0;
    public sessionChangeMessageInterval = 1 * 1000; // 1 second

    constructor(
        protected readonly branchDataProviderManager: TenantResourceBranchDataProviderManager,
        onDidChangeBranchTreeData: vscode.Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined>,
        onRefresh: vscode.Event<void | ResourceGroupsItem | ResourceGroupsItem[] | null | undefined>,
        protected readonly resourceProviderManager: TenantResourceProviderManager,
        branchItemCache: BranchDataItemCache,
        callOnDispose?: () => void) {
        super(
            branchItemCache,
            onDidChangeBranchTreeData,
            resourceProviderManager.onDidChangeResourceChange,
            onRefresh,
            undefined,
            () => {
                this.statusSubscription?.dispose();
                callOnDispose?.();
            });
    }

    async onGetChildren(element?: ResourceGroupsItem | undefined): Promise<ResourceGroupsItem[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('azureTenantsView.getChildren', async (context: IActionContext) => {
            if (element) {
                return await element.getChildren();
            } else {
                const subscriptionProvider = await getAzureSubscriptionProvider(this);
                const children: ResourceGroupsItem[] = await OnGetChildrenBase(subscriptionProvider);

                if (children.length === 0) {
                    const accounts = await vscode.authentication.getAccounts(getConfiguredAuthProviderId());
                    context.telemetry.properties.accountCount = accounts.length.toString();
                    for (const account of accounts) {
                        const tenants = await subscriptionProvider.getTenants(account);
                        const tenantItems: ResourceGroupsItem[] = [];
                        for await (const tenant of tenants) {
                            const isSignedIn = await subscriptionProvider.isSignedIn(nonNullProp(tenant, 'tenantId'), account);
                            tenantItems.push(new TenantTreeItem(tenant, account, {
                                contextValue: isSignedIn ? 'tenantName' : 'tenantNameNotSignedIn',
                                checkboxState: (!isSignedIn || isTenantFilteredOut(nonNullProp(tenant, 'tenantId'), account.id)) ?
                                    vscode.TreeItemCheckboxState.Unchecked : vscode.TreeItemCheckboxState.Checked,
                                description: tenant.tenantId
                            }));
                        }

                        children.push(new GenericItem(nonNullValueAndProp(account, 'label'), {
                            children: tenantItems,
                            iconPath: new vscode.ThemeIcon('account'),
                            contextValue: 'accountName',
                            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                        }));
                    }
                }
                return children;
            }
        });
    }
}
