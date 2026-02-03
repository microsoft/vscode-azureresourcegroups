/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzureAccount, AzureSubscriptionProvider, isNotSignedInError } from '@microsoft/vscode-azext-azureauth';
import { IActionContext, TreeElementBase, callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { ResourceModelBase } from 'api/src';
import * as vscode from 'vscode';
import { TenantResourceProviderManager } from '../../api/ResourceProviderManagers';
import { ext } from '../../extensionVariables';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { GenericItem } from '../GenericItem';
import { getSignInTreeItems, tryGetLoggingInTreeItems } from '../getSignInTreeItems';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from "../ResourceTreeDataProviderBase";
import { isTenantFilteredOut } from './registerTenantTree';
import { TenantResourceBranchDataProviderManager } from "./TenantResourceBranchDataProviderManager";
import { TenantTreeItem } from './TenantTreeItem';

export class TenantResourceTreeDataProvider extends ResourceTreeDataProviderBase {
    private hasLoadedTenants: boolean = false;

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
        // Create cancellation token for this load operation - cancels any pending previous load
        const cancellationToken = this.createLoadCancellationToken();

        return await callWithTelemetryAndErrorHandling('azureTenantsView.getChildren', async (context: IActionContext) => {
            context.errorHandling.suppressDisplay = true;

            const isFirstLoad = !this.hasLoadedTenants;
            this.hasLoadedTenants = true;
            context.telemetry.properties.isFirstLoad = String(isFirstLoad);

            const maybeLogInItems = tryGetLoggingInTreeItems();
            if (maybeLogInItems?.length) {
                return maybeLogInItems;
            }

            const subscriptionProvider = await this.getAzureSubscriptionProvider();

            // Atomically consume the clear cache flag - only the first tree to load will get true
            const shouldClearCache = ext.consumeClearCacheFlag();

            try {
                const accounts = await subscriptionProvider.getAccounts({ filter: false, noCache: shouldClearCache, token: cancellationToken });
                context.telemetry.properties.isSignedIn = 'true';
                context.telemetry.properties.accountCount = accounts.length.toString();

                // Process accounts in parallel for better performance with multiple accounts
                const accountItems = await Promise.all(
                    accounts.map(account => this.getTenantsForAccountSafe(subscriptionProvider, account, shouldClearCache, cancellationToken))
                );

                // Filter out undefined items (accounts that failed to load)
                return accountItems.filter((item): item is ResourceGroupsItem => item !== undefined);
            } catch (error) {
                if (isNotSignedInError(error)) {
                    context.telemetry.properties.outcome = 'notSignedIn';
                    return getSignInTreeItems(false);
                }

                // For unexpected errors, log via telemetry but return empty array
                // to avoid disrupting the UI (preserving prior behavior).
                context.telemetry.properties.outcome = 'error';
                context.telemetry.properties.unhandledError = String(error);
                return [];
            }
        });
    }

    /**
     * Gets tenants for an account, handling NotSignedInError gracefully.
     * If the account can't be accessed (e.g., session expired), returns undefined to skip it.
     */
    private async getTenantsForAccountSafe(subscriptionProvider: AzureSubscriptionProvider, account: AzureAccount, shouldClearCache: boolean, token?: vscode.CancellationToken): Promise<ResourceGroupsItem | undefined> {
        try {
            const allTenants = await subscriptionProvider.getTenantsForAccount(account, { filter: false, noCache: shouldClearCache, token });
            const unauthenticatedTenants = await subscriptionProvider.getUnauthenticatedTenantsForAccount(account, { token });
            const unauthenticatedTenantIds = new Set(unauthenticatedTenants.map(uat => uat.tenantId));
            const tenantItems: ResourceGroupsItem[] = [];

            for (const tenant of allTenants) {
                const isSignedIn = !unauthenticatedTenantIds.has(tenant.tenantId);
                tenantItems.push(new TenantTreeItem(tenant, account, {
                    contextValue: isSignedIn ? 'tenantName' : 'tenantNameNotSignedIn',
                    checkboxState: (!isSignedIn || isTenantFilteredOut(tenant.tenantId, account.id)) ?
                        vscode.TreeItemCheckboxState.Unchecked : vscode.TreeItemCheckboxState.Checked,
                    description: tenant.tenantId
                }));
            }

            return new GenericItem(account.label, {
                children: tenantItems,
                iconPath: new vscode.ThemeIcon('account'),
                contextValue: 'accountName',
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
            });
        } catch (error) {
            if (isNotSignedInError(error)) {
                // Skip this account if we can't get a session for it
                return undefined;
            }
            throw error;
        }
    }
}
