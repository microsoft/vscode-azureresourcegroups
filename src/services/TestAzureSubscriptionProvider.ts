/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SubscriptionClient, TenantIdDescription } from '@azure/arm-resources-subscriptions';
import { type ServiceClient } from '@azure/core-client';
import { createHttpHeaders, createPipelineRequest, type PipelineRequest, type PipelineResponse } from '@azure/core-rest-pipeline';
import { AzureAuthentication, AzureSubscriptionProvider, getConfiguredAzureEnv, type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { createGenericClient } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
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
    private _tokenCredential: TokenCredential & { tenantId?: string } | undefined;
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
        return !!this._tokenCredential;
    }

    public async signIn(): Promise<boolean> {
        /** HARD-CODED VALUES; MODIFY LATER TO OBTAIN THROUGH KEYVALUE!!
 * Constants required to connect to the appropriate Azure DevOps federated service connection
 */
        /**
         * The resource ID of the Azure DevOps federated service connection,
        *   which can be found on the `resourceId` field of the URL at the address bar
        *   when viewing the service connection in the Azure DevOps portal
         */
        const SERVICE_CONNECTION_ID = "5c78f1d7-3284-4dfd-95f8-856331324e29";
        /**
         * The `Tenant ID` field of the service connection properties
         */
        const DOMAIN = "72f988bf-86f1-41af-91ab-2d7cd011db47";
        /**
         * The `Service Principal Id` field of the service connection properties
         */
        const CLIENT_ID = "9fb13fa5-3dde-4970-bba5-c58b89e1fadc";
        console.log('NIGHTLY: starting nightly tests');
        const tokenCredential: TokenCredential = await getTokenCredential(SERVICE_CONNECTION_ID, DOMAIN, CLIENT_ID);
        console.log('NIGHTLY: successfully acquired TokenCredential');
        console.log(`NIGHTLY: TokeCredential: ${JSON.stringify(tokenCredential)}`);

        this._tokenCredential = tokenCredential;
        return !!this._tokenCredential;
    }

    public async signOut(): Promise<void> {
        this._tokenCredential = undefined;
    }

    public async getTenants(): Promise<TenantIdDescription[]> {
        console.debug('***tenantId***: ', this._tokenCredential?.tenantId)
        return [{
            tenantId: this._tokenCredential?.tenantId,
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
        console.debug('***environment***: ', environment);

        const subscriptions: AzureSubscription[] = [];

        for await (const subscription of client.subscriptions.list()) {
            console.debug('***subscription***: ', subscription);
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
    private async getSubscriptionClient(_tenantId?: string, _scopes?: string[]): Promise<{ client: SubscriptionClient, credential: TokenCredential, authentication: AzureAuthentication }> {
        const armSubs = await import('@azure/arm-resources-subscriptions');
        if (!this._tokenCredential) {
            throw new Error('Not signed in');
        }


        return {
            client: new armSubs.SubscriptionClient(this._tokenCredential,),
            credential: this._tokenCredential,
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

/*
* Get a TokenCredential object from a federated DevOps service connection, using workflow identity federation
* Reference: https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation
*
* @param serviceConnectionId The resource ID of the Azure DevOps federated service connection,
*   which can be found on the `resourceId` field of the URL at the address bar when viewing the service connection in the Azure DevOps portal
* @param domain The `Tenant ID` field of the service connection properties
* @param clientId The `Service Principal Id` field of the service connection properties
*/
async function getTokenCredential(serviceConnectionId: string, domain: string, clientId: string): Promise<TokenCredential> {
    if (!process.env.AGENT_BUILDDIRECTORY) {
        // Assume that AGENT_BUILDDIRECTORY is set if running in an Azure DevOps pipeline.
        // So when not running in an Azure DevOps pipeline, throw an error since we cannot use the DevOps federated service connection credential.
        // @todo: use interactive browser credential from @azure/identity to enable running of tests locally (assuming the developer has the necessary permissions).
        throw new Error(`Cannot create DevOps federated service connection credential outside of an Azure DevOps pipeline.`);
    } else {
        console.log(`Creating DevOps federated service connection credential for service connection..`);

        // Pre-defined DevOps variable reference: https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables?view=azure-devops
        const systemAccessToken = process.env.SYSTEM_ACCESSTOKEN;
        const teamFoundationCollectionUri = process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI;
        const teamProjectId = process.env.SYSTEM_TEAMPROJECTID;
        const planId = process.env.SYSTEM_PLANID;
        const jobId = process.env.SYSTEM_JOBID;
        if (!systemAccessToken || !teamFoundationCollectionUri || !teamProjectId || !planId || !jobId) {
            throw new Error(`Azure DevOps environment variables are not set.\n
            process.env.SYSTEM_ACCESSTOKEN: ${process.env.SYSTEM_ACCESSTOKEN ? "✅" : "❌"}\n
            process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: ${process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI ? "✅" : "❌"}\n
            process.env.SYSTEM_TEAMPROJECTID: ${process.env.SYSTEM_TEAMPROJECTID ? "✅" : "❌"}\n
            process.env.SYSTEM_PLANID: ${process.env.SYSTEM_PLANID ? "✅" : "❌"}\n
            process.env.SYSTEM_JOBID: ${process.env.SYSTEM_JOBID ? "✅" : "❌"}\n
            REMEMBER: process.env.SYSTEM_ACCESSTOKEN must be explicitly mapped!\n
            https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables?view=azure-devops&tabs=yaml#systemaccesstoken
        `);
        }

        const oidcRequestUrl = `${teamFoundationCollectionUri}${teamProjectId}/_apis/distributedtask/hubs/build/plans/${planId}/jobs/${jobId}/oidctoken?api-version=7.1-preview.1&serviceConnectionId=${serviceConnectionId}`;

        const { ClientAssertionCredential } = await import("@azure/identity");
        return new ClientAssertionCredential(domain, clientId, () => requestOidcToken(oidcRequestUrl, systemAccessToken));
    }
}

/**
 * API reference: https://learn.microsoft.com/en-us/rest/api/azure/devops/distributedtask/oidctoken/create
 */
async function requestOidcToken(oidcRequestUrl: string, systemAccessToken: string): Promise<string> {
    return await callWithTelemetryAndErrorHandling('azureResourceGroups.requestOidcToken', async (context) => {
        const client: ServiceClient = await createGenericClient(context, undefined);
        const request: PipelineRequest = createPipelineRequest({
            url: oidcRequestUrl,
            method: "POST",
            headers: createHttpHeaders({
                "Content-Type": "application/json",
                "Authorization": `Bearer ${systemAccessToken}`
            })
        });

        const response: PipelineResponse = await client.sendRequest(request);
        const body: string = response.bodyAsText?.toString() || "";


        if (response.status !== 200) {
            throw new Error(`Failed to get OIDC token:\n
            Response status: ${response.status}\n
            Response body: ${body}\n
            Response headers: ${JSON.stringify(response.headers.toJSON())}
        `);
        } else {
            console.log(`Successfully got OIDC token with status ${response.status}`);
        }
        return (JSON.parse(body) as { oidcToken: string }).oidcToken;
    }) || '';
}
