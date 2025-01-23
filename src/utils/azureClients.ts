/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { ManagedServiceIdentityClient } from "@azure/arm-msi";
import { ResourceManagementClient } from '@azure/arm-resources';
import { AzExtClientContext, createAzureClient, parseClientContext } from '@microsoft/vscode-azext-azureutils';

// Lazy-load @azure packages to improve startup performance.
// NOTE: The client is the only import that matters, the rest of the types disappear when compiled to JavaScript

export async function createResourceClient(context: AzExtClientContext): Promise<ResourceManagementClient> {
    if (parseClientContext(context).isCustomCloud) {
        return <ResourceManagementClient><unknown>createAzureClient(context, (await import('@azure/arm-resources-profile-2020-09-01-hybrid')).ResourceManagementClient);
    } else {
        return createAzureClient(context, (await import('@azure/arm-resources')).ResourceManagementClient);
    }
}

export async function createManagedServiceIdentityClient(context: AzExtClientContext): Promise<ManagedServiceIdentityClient> {
    return createAzureClient(context, (await import('@azure/arm-msi')).ManagedServiceIdentityClient);
}

export async function createAuthorizationManagementClient(context: AzExtClientContext): Promise<AuthorizationManagementClient> {
    return createAzureClient(context, (await import('@azure/arm-authorization')).AuthorizationManagementClient);
}
