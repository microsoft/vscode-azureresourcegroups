/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { isNotSignedInError } from '@microsoft/vscode-azext-azureauth';
import { IActionContext, TreeElementBase, callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { ResourceModelBase } from 'api/src';
import * as vscode from 'vscode';
import { TenantResourceProviderManager } from '../../api/ResourceProviderManagers';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { GenericItem } from '../GenericItem';
import { getSignInTreeItems, tryGetLoggingInTreeItems } from '../getSignInTreeItems';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from "../ResourceTreeDataProviderBase";
import { isTenantFilteredOut } from './registerTenantTree';
import { TenantResourceBranchDataProviderManager } from "./TenantResourceBranchDataProviderManager";
import { TenantTreeItem } from './TenantTreeItem';

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
            if (element?.getChildren) {
                return await element.getChildren();
            } else {
                const maybeLogInItems = tryGetLoggingInTreeItems();
                if (maybeLogInItems?.length) {
                    return maybeLogInItems;
                }

                const subscriptionProvider = await this.getAzureSubscriptionProvider();
                const children: ResourceGroupsItem[] = [];

                try {
                    const accounts = await subscriptionProvider.getAccounts({ filter: false });
                    context.telemetry.properties.accountCount = accounts.length.toString();
                    for (const account of accounts) {
                        const allTenants = await subscriptionProvider.getTenantsForAccount(account, { filter: false });
                        const unauthenticatedTenants = await subscriptionProvider.getUnauthenticatedTenantsForAccount(account);
                        const tenantItems: ResourceGroupsItem[] = [];
                        for await (const tenant of allTenants) {
                            // TODO: This is n^2 which is not great, but the number of tenants is usually quite small
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
                    return children;
                } catch (error) {
                    if (isNotSignedInError(error)) {
                        return getSignInTreeItems(false);
                    }

                    // TODO: Else do we throw? What did we do before?
                    return [];
                }
            }
        });
    }
}
