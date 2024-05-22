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
import { settingUtils } from '../../utils/settingUtils';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { GenericItem } from '../GenericItem';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from "../ResourceTreeDataProviderBase";
import { TreeItemStateStore } from '../TreeItemState';
import { TenantResourceBranchDataProviderManager } from "./TenantResourceBranchDataProviderManager";
import { TenantTreeItem } from './TenantTreeItem';

export class TenantResourceTreeDataProvider extends ResourceTreeDataProviderBase {
    private subscriptionProvider: AzureSubscriptionProvider | undefined;
    private statusSubscription: vscode.Disposable | undefined;

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
            //get the accounts
            const children: ResourceGroupsItem[] = [];

            const subscriptionProvider = await this.getAzureSubscriptionProvider();
            if (subscriptionProvider) {
                const session = await vscode.authentication.getSession('microsoft', ['https://management.azure.com/.default']); //alex will be looking into this since this will break for sovereign clouds
                const tenant: TenantIdDescription[] = await subscriptionProvider.getTenants();
                const tenantItems: ResourceGroupsItem[] = []
                tenant.map(async tenant => tenantItems.push(new TenantTreeItem(nonNullProp(tenant, 'displayName'), nonNullProp(tenant, 'id'), {
                    contextValue: 'tenantName',
                    checkboxState: this.checkUnselectedTenants(nonNullProp(tenant, 'id')) ? vscode.TreeItemCheckboxState.Unchecked : vscode.TreeItemCheckboxState.Checked,
                    description: tenant.defaultDomain,
                    children: await subscriptionProvider.isSignedIn(nonNullProp(tenant, 'id')) ?
                        [new GenericItem('Sign in...', {
                            commandId: 'azureResourceGroups.signInToTenant', //not sure of this
                            commandArgs: [tenant.id]
                        })] : undefined
                })));
                children.push(new GenericItem(nonNullValueAndProp(session?.account, 'label'), {
                    children: tenantItems,
                    iconPath: new vscode.ThemeIcon('account'),
                    contextValue: 'accountName',
                }));
            } else {
                //if not signed in show a message that you are not signed in
            }

            return children;
        }
    }

    public async getAzureSubscriptionProvider(): Promise<AzureSubscriptionProvider> {
        // override for testing
        if (ext.testing.overrideAzureSubscriptionProvider) {
            return ext.testing.overrideAzureSubscriptionProvider();
        } else {
            if (!this.subscriptionProvider) {
                this.subscriptionProvider = await ext.subscriptionProviderFactory();
            }
            this.statusSubscription = vscode.authentication.onDidChangeSessions((evt: vscode.AuthenticationSessionsChangeEvent) => {
                if (evt.provider.id === 'microsoft' || evt.provider.id === 'microsoft-sovereign-cloud') {
                    if (Date.now() > nextSessionChangeMessageMinimumTime) {
                        nextSessionChangeMessageMinimumTime = Date.now() + sessionChangeMessageInterval;
                        // This event gets HEAVILY spammed and needs to be debounced
                        // Suppress additional messages for 1 second after the first one
                        this.notifyTreeDataChanged();
                    }
                }
            });

            return this.subscriptionProvider;
        }
    }

    private checkUnselectedTenants(tenantId: string): boolean {
        const settings = settingUtils.getGlobalSetting<string[] | undefined>('unselectedTenants')
        if (settings) {
            if (settings.includes(tenantId)) {
                return true;
            }
        }
        return false;
    }
}

let nextSessionChangeMessageMinimumTime = 0;
const sessionChangeMessageInterval = 1 * 1000; // 1 second
