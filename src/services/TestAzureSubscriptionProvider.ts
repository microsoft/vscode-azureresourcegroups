/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SubscriptionClient, TenantIdDescription } from '@azure/arm-resources-subscriptions';
import { AzureAuthentication, AzureSubscriptionProvider, getConfiguredAzureEnv, type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { Disposable, Event } from 'vscode';

let testAzureSubscriptionProvider: TestAzureSubscriptionProvider | undefined;

export function createTestAzureSubscriptionProviderFactory(): () => Promise<TestAzureSubscriptionProvider> {
    return async (): Promise<TestAzureSubscriptionProvider> => {
        testAzureSubscriptionProvider ??= await createTestAzureSubscriptionProvider();
        return testAzureSubscriptionProvider;
    }
}

async function createTestAzureSubscriptionProvider(): Promise<TestAzureSubscriptionProvider> {
    // This will update the selected subscription IDs to ensure the filters are in the form of `${tenantId}/${subscriptionId}`
    // await getSelectedTenantAndSubscriptionIds();

    return new TestAzureSubscriptionProvider();
}


export class TestAzureSubscriptionProvider implements AzureSubscriptionProvider {
    // SHOULD NOT EXTEND VSCodeAzureSubscriptionProvider, TOO MANY COMMANDS RELY ON VSCODE SESSION
    // CONSTRUCTOR SHOULDN'T NEED MOCK RESOURCES

    async getSubscriptions(_filter: boolean): Promise<AzureSubscription[]> {
        // AZURE SUBSCRIPTIONS SHOULD BE FROM REAL ACCOUNT
        const results: AzureSubscription[] = [];

        // Get the list of tenants
        for (const tenant of await this.getTenants()) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const tenantId = tenant.tenantId!;

            // If the user is not signed in to this tenant, then skip it
            // if (!(await this.isSignedIn(tenantId))) {
            //     continue;
            // }

            // For each tenant, get the list of subscriptions
            results.push(...await this.getSubscriptionsForTenant(tenantId));
        }

        const sortSubscriptions = (subscriptions: AzureSubscription[]): AzureSubscription[] =>
            subscriptions.sort((a, b) => a.name.localeCompare(b.name));

        return sortSubscriptions(results);
    }

    public async isSignedIn(): Promise<boolean> {
        return true;
    }

    public async signIn(): Promise<boolean> {
        return true;
    }

    public async signOut(): Promise<void> {
        throw new Error('Method not implemented.');
    }

    public async getTenants(): Promise<TenantIdDescription[]> {
        return [{
            tenantId: 'tenantId',
        }];
    }

    /**
     * Gets the subscriptions for a given tenant.
     *
     * @param tenantId The tenant ID to get subscriptions for.
     *
     * @returns The list of subscriptions for the tenant.
     */
    private async getSubscriptionsForTenant(tenantId: string): Promise<AzureSubscription[]> {
        const { client, credential, authentication } = await this.getSubscriptionClient(tenantId);
        const environment = getConfiguredAzureEnv();

        const subscriptions: AzureSubscription[] = [];

        for await (const subscription of client.subscriptions.list()) {
            subscriptions.push({
                authentication: authentication,
                environment: environment,
                credential: credential,
                isCustomCloud: environment.isCustomCloud,
                /* eslint-disable @typescript-eslint/no-non-null-assertion */
                name: subscription.displayName!,
                subscriptionId: subscription.subscriptionId!,
                /* eslint-enable @typescript-eslint/no-non-null-assertion */
                tenantId: tenantId,
            });
        }

        return subscriptions;
    }

    /**
     * Gets a fully-configured subscription client for a given tenant ID
     *
     * @param tenantId (Optional) The tenant ID to get a client for
     *
     * @returns A client, the credential used by the client, and the authentication function
     */
    private async getSubscriptionClient(accessToken: string, _tenantId?: string, _scopes?: string[]): Promise<{ client: SubscriptionClient, credential: TokenCredential, authentication: AzureAuthentication }> {
        const armSubs = await import('@azure/arm-resources-subscriptions');
        const credential: TokenCredential = {
            getToken: async () => {
                return {
                    token: accessToken,
                    expiresOnTimestamp: 0
                };
            }
        }

        return {
            client: new armSubs.SubscriptionClient(credential,),
            credential: credential,
            authentication: {
                getSession: () => {
                    // SHOULD BE OKAY TO BE UNDEFINED?
                    return undefined;
                }
            }
        };
    }

    public onDidSignIn: Event<void> = () => { return new Disposable(() => { }) };
    public onDidSignOut: Event<void> = () => { return new Disposable(() => { }) };
}

/**
 * Represents a credential capable of providing an authentication token.
 */
export declare interface TokenCredential {
    /**
     * Gets the token provided by this credential.
     *
     * This method is called automatically by Azure SDK client libraries. You may call this method
     * directly, but you must also handle token caching and token refreshing.
     *
     * @param scopes - The list of scopes for which the token will have access.
     * @param options - The options used to configure any requests this
     *                TokenCredential implementation might make.
     */
    getToken(scopes: string | string[]): Promise<AccessToken | null>;
}
/**
 * Represents an access token with an expiration time.
 */
export declare interface AccessToken {
    /**
     * The access token returned by the authentication service.
     */
    token: string;
    /**
     * The access token's expiration timestamp in milliseconds, UNIX epoch time.
     */
    expiresOnTimestamp: number;
}
