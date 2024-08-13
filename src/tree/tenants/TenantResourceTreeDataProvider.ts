/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { SubscriptionClient, TenantIdDescription } from '@azure/arm-resources-subscriptions';
import type { TokenCredential } from '@azure/core-auth'; // Keep this as `import type` to avoid actually loading the package (at all, this one is dev-only)
import { AzureSubscriptionProvider, getConfiguredAuthProviderId, getConfiguredAzureEnv, NotSignedInError } from '@microsoft/vscode-azext-azureauth';
import { nonNullProp, nonNullValueAndProp } from '@microsoft/vscode-azext-utils';
import { ResourceModelBase } from 'api/src';
import * as vscode from 'vscode';
import { TenantResourceProviderManager } from '../../api/ResourceProviderManagers';
import { ext } from '../../extensionVariables';
import { BranchDataItemCache } from '../BranchDataItemCache';
import { GenericItem } from '../GenericItem';
import { getAzureSubscriptionProvider, OnGetChildrenBase } from '../OnGetChildrenBase';
import { ResourceGroupsItem } from '../ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from "../ResourceTreeDataProviderBase";
import { TreeItemStateStore } from '../TreeItemState';
import { TenantResourceBranchDataProviderManager } from "./TenantResourceBranchDataProviderManager";
import { TenantTreeItem } from './TenantTreeItem';

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
        state: TreeItemStateStore,
        branchItemCache: BranchDataItemCache,
        callOnDispose?: () => void) {
        super(
            branchItemCache,
            onDidChangeBranchTreeData,
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
                const accounts = await vscode.authentication.getAccounts(getConfiguredAuthProviderId());
                for (const account of accounts) {
                    const session = await vscode.authentication.getSession(getConfiguredAuthProviderId(), getScopes(undefined), { account: account });
                    const tenants = await this.getTenants(session);
                    const tenantItems: ResourceGroupsItem[] = [];
                    for await (const tenant of tenants) {
                        const isSignedIn = await subscriptionProvider.isSignedIn(nonNullProp(tenant, 'tenantId'));
                        tenantItems.push(new TenantTreeItem(nonNullProp(tenant, 'displayName'), nonNullProp(tenant, 'tenantId'), nonNullProp(account, 'id'), {
                            contextValue: isSignedIn ? 'tenantName' : 'tenantNameNotSignedIn',
                            checkboxState: (!(isSignedIn) || this.checkUnselectedTenants(nonNullProp(tenant, 'tenantId'))) ?
                                vscode.TreeItemCheckboxState.Unchecked : vscode.TreeItemCheckboxState.Checked, // Make sure tenants which are not signed in are unchecked
                            description: tenant.defaultDomain
                        }));
                    }

                    children.push(new GenericItem(nonNullValueAndProp(session?.account, 'label'), {
                        children: tenantItems,
                        iconPath: new vscode.ThemeIcon('account'),
                        contextValue: 'accountName',
                        collapsibleState: vscode.TreeItemCollapsibleState.Expanded
                    }));
                }
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

    // These methods are from the auth package moving here for testing purposes until we change and release the auth package

    /**
     * Gets a list of tenants available to the user.
     * Use {@link isSignedIn} to check if the user is signed in to a particular tenant.
     *
     * @returns A list of tenants.
     */
    public async getTenants(session?: vscode.AuthenticationSession): Promise<TenantIdDescription[]> {
        const { client } = await this.getSubscriptionClient(undefined, undefined, session);

        const results: TenantIdDescription[] = [];

        for await (const tenant of client.tenants.list()) {
            results.push(tenant);
        }

        return results;
    }

    /**
     * Gets a fully-configured subscription client for a given tenant ID
     *
     * @param tenantId (Optional) The tenant ID to get a client for
     *
     * @returns A client, the credential used by the client, and the authentication function
     */
    private async getSubscriptionClient(tenantId?: string, scopes?: string[], session?: vscode.AuthenticationSession): Promise<{ client: SubscriptionClient, credential: TokenCredential, authentication: AzureAuthentication }> {
        const armSubs = await import('@azure/arm-resources-subscriptions');
        if (!session) {
            session = await getSessionFromVSCode(scopes, tenantId, { createIfNone: false, silent: true });
        }

        if (!session) {
            throw new NotSignedInError();
        }

        const credential: TokenCredential = {
            getToken: async () => {
                return {
                    token: session.accessToken,
                    expiresOnTimestamp: 0
                };
            }
        }

        const configuredAzureEnv = getConfiguredAzureEnv();
        const endpoint = configuredAzureEnv.resourceManagerEndpointUrl;

        return {
            client: new armSubs.SubscriptionClient(credential, { endpoint }),
            credential: credential,
            authentication: {
                getSession: () => session
            }
        };
    }
}

/**
 * Wraps {@link vscode.authentication.getSession} and handles:
 * * Passing the configured auth provider id
 * * Getting the list of scopes, adding the tenant id to the scope list if needed
 *
 * @param scopes - top-level resource scopes (e.g. http://management.azure.com, http://storage.azure.com) or .default scopes. All resources/scopes will be normalized to the `.default` scope for each resource.
 * @param tenantId - (Optional) The tenant ID, will be added to the scopes
 * @param options - see {@link vscode.AuthenticationGetSessionOptions}
 * @returns An authentication session if available, or undefined if there are no sessions
 */
export async function getSessionFromVSCode(scopes?: string | string[], tenantId?: string, options?: vscode.AuthenticationGetSessionOptions): Promise<vscode.AuthenticationSession | undefined> {
    return await vscode.authentication.getSession(getConfiguredAuthProviderId(), getScopes(scopes, tenantId), options);
}

function getScopes(scopes: string | string[] | undefined, tenantId?: string): string[] {
    let scopeArr = getResourceScopes(scopes);
    if (tenantId) {
        scopeArr = addTenantIdScope(scopeArr, tenantId);
    }
    return scopeArr;
}

function getResourceScopes(scopes?: string | string[]): string[] {
    if (scopes === undefined || scopes === "" || scopes.length === 0) {
        scopes = ensureEndingSlash(getConfiguredAzureEnv().managementEndpointUrl);
    }
    const arrScopes = (Array.isArray(scopes) ? scopes : [scopes])
        .map((scope) => {
            if (scope.endsWith('.default')) {
                return scope;
            } else {
                return `${scope}.default`;
            }
        });
    return Array.from(new Set<string>(arrScopes));
}

function addTenantIdScope(scopes: string[], tenantId: string): string[] {
    const scopeSet = new Set<string>(scopes);
    scopeSet.add(`VSCODE_TENANT:${tenantId}`);
    return Array.from(scopeSet);
}

function ensureEndingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
}

