/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISubscriptionContext } from '@microsoft/vscode-azext-utils';

export async function createContainerAppsSandboxClient(subscription: ISubscriptionContext) {
    const { ContainerAppsSandboxManagementClient } = await import('@azure/containerapps-sandbox');
    return new ContainerAppsSandboxManagementClient(
        subscription.credentials,
        subscription.subscriptionId,
        { endpoint: subscription.environment.resourceManagerEndpointUrl },
    );
}
