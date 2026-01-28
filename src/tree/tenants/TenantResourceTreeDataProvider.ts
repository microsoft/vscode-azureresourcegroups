/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { getConfiguredAuthProviderId } from '@microsoft/vscode-azext-azureauth';
import { IActionContext, TreeElementBase, callWithTelemetryAndErrorHandling, nonNullProp, nonNullValueAndProp } from '@microsoft/vscode-azext-utils';
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
        if (element) {
            return await element.getChildren();
        } else {
            return await this.getRootChildren();
        }
    }

    /**
     * Gets the root children (accounts and tenants) for the Accounts & Tenants tree.
     * Wrapped in telemetry to measure initial load performance.
     */
    private async getRootChildren(): Promise<ResourceGroupsItem[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('azureTenantsView.initialLoadTenants', async (context: IActionContext) => {
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;

            const subscriptionProvider = await this.getAzureSubscriptionProvider();

            const isSignedIn = await subscriptionProvider.isSignedIn();
            context.telemetry.properties.isSignedIn = String(isSignedIn);

            const children: ResourceGroupsItem[] = await onGetAzureChildrenBase(subscriptionProvider);

            if (children.length === 0) {
                const accounts = Array.from((await vscode.authentication.getAccounts(getConfiguredAuthProviderId()))).sort((a, b) => a.label.localeCompare(b.label));
                context.telemetry.measurements.accountCount = accounts.length;

                let totalTenantCount = 0;
                let tenantsNotSignedInCount = 0;
                for (const account of accounts) {
                    const tenants = (await subscriptionProvider.getTenants(account))
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        .sort((a, b) => a.displayName!.localeCompare(b.displayName!));
                    totalTenantCount += tenants.length;

                    const tenantItems: ResourceGroupsItem[] = [];
                    for await (const tenant of tenants) {
                        const isTenantSignedIn = await subscriptionProvider.isSignedIn(nonNullProp(tenant, 'tenantId'), account);
                        if (!isTenantSignedIn) {
                            tenantsNotSignedInCount++;
                        }
                        tenantItems.push(new TenantTreeItem(tenant, account, {
                            contextValue: isTenantSignedIn ? 'tenantName' : 'tenantNameNotSignedIn',
                            checkboxState: (!isTenantSignedIn || isTenantFilteredOut(nonNullProp(tenant, 'tenantId'), account.id)) ?
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
                context.telemetry.measurements.tenantCount = totalTenantCount;
                context.telemetry.measurements.tenantsNotSignedInCount = tenantsNotSignedInCount;
            }
            return children;
        });
    }
}
