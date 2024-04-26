/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ServiceClient } from '@azure/core-client';
import { createHttpHeaders, createPipelineRequest, type PipelineRequest, type PipelineResponse } from '@azure/core-rest-pipeline';
import { type TokenCredential } from '@azure/identity';
import { createGenericClient } from '@microsoft/vscode-azext-azureutils';
import { createTestActionContext, TestActionContext, TestOutputChannel, TestUserInput } from '@microsoft/vscode-azext-dev';
import * as vscode from 'vscode';
import { ext, registerOnActionStartHandler } from '../extension.bundle';

export let longRunningTestsEnabled: boolean;

// Runs before all tests
suiteSetup(async function (this: Mocha.Context): Promise<void> {
    this.timeout(1 * 60 * 1000);

    await vscode.extensions.getExtension('ms-azuretools.vscode-azureresourcegroups')?.activate();

    await vscode.commands.executeCommand('azureResourceGroups.refresh'); // activate the extension before tests begin
    ext.outputChannel = new TestOutputChannel();

    registerOnActionStartHandler(context => {
        // Use `TestUserInput` by default so we get an error if an unexpected call to `context.ui` occurs, rather than timing out
        context.ui = new TestUserInput(vscode);
    });

    longRunningTestsEnabled = true; //!/^(false|0)?$/i.test(process.env.ENABLE_LONG_RUNNING_TESTS || '');

    /** HARD-CODED VALUES; MODIFY LATER TO OBTAIN THROUGH KEYVALUE!!
 * Constants required to connect to the appropriate Azure DevOps federated service connection
 */
    /**
     * The resource ID of the Azure DevOps federated service connection,
    *   which can be found on the `resourceId` field of the URL at the address bar
    *   when viewing the service connection in the Azure DevOps portal
     */
    const SERVICE_CONNECTION_ID = "816925d8-6f4a-4b37-8c74-1c16efe33e27";
    /**
     * The `Tenant ID` field of the service connection properties
     */
    const DOMAIN = "72f988bf-86f1-41af-91ab-2d7cd011db47";
    /**
     * The `Service Principal Id` field of the service connection properties
     */
    const CLIENT_ID = "a581a512-0b3b-43b0-bb17-39e24d998b0a";
    console.log('NIGHTLY: starting nightly tests');
    const tokenCredential: TokenCredential = await getTokenCredential(SERVICE_CONNECTION_ID, DOMAIN, CLIENT_ID);
    console.log('NIGHTLY: successfully acquired TokenCredential');
    console.log(`NIGHTLY: TokeCredential: ${JSON.stringify(tokenCredential)}`);
});

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
    const dummyContext: TestActionContext = await createTestActionContext();
    const client: ServiceClient = await createGenericClient(dummyContext, undefined);
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
    return JSON.parse(body).oidcToken;
}
