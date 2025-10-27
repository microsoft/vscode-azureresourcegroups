/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext, TreeElementBase, callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { ResourceModelBase } from 'api/src';
import * as vscode from 'vscode';
import { TenantResourceProviderManager } from '../../api/ResourceProviderManagers';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { GenericItem } from '../GenericItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from "../ResourceTreeDataProviderBase";
import { onGetAzureChildrenBase } from '../onGetAzureChildrenBase';
import { TenantResourceBranchDataProviderManager } from "./TenantResourceBranchDataProviderManager";
import { TenantTreeItem } from './TenantTreeItem';
import { isTenantFilteredOut } from './registerTenantTree';

export class TenantResourceTreeDataProvider extends ResourceTreeDataProviderBase {
    constructor(
        protected readonly branchDataProviderManager: TenantResourceBranchDataProviderManager,
        onDidChangeBranchTreeData: vscode.Event<void | ResourceModelBase | ResourceModelBase[] | null | undefined>,
        onRefresh: vscode.Event<void | TreeElementBase | TreeElementBase[] | null | undefined>,
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
                const subscriptionProvider = await this.getAzureSubscriptionProvider();
                const children: ResourceGroupsItem[] = await onGetAzureChildrenBase(subscriptionProvider);

                if (children.length === 0) {
                    const accounts = await subscriptionProvider.getAccounts({ all: true });
                    context.telemetry.properties.accountCount = accounts.length.toString();
                    for (const account of accounts) {
                        const tenants = await subscriptionProvider.getTenantsForAccount(account, { all: true });
                        const unauthenticatedTenants = await subscriptionProvider.getUnauthenticatedTenantsForAccount(account);
                        const tenantItems: ResourceGroupsItem[] = [];
                        for await (const tenant of tenants) {
                            const isSignedIn = !unauthenticatedTenants.some(uat => uat.tenantId === tenant.tenantId);
                            tenantItems.push(new TenantTreeItem(tenant, account, {
                                contextValue: isSignedIn ? 'tenantName' : 'tenantNameNotSignedIn',
                                checkboxState: (!isSignedIn || isTenantFilteredOut(tenant.tenantId, account.id)) ?
                                    vscode.TreeItemCheckboxState.Unchecked : vscode.TreeItemCheckboxState.Checked,
                                description: tenant.tenantId
                            }));
                        }

                        children.push(new GenericItem(account.label, {
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
