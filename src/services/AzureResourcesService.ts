/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResource, ResourceGroup, ResourceManagementClient } from "@azure/arm-resources";
import { getSessionFromVSCode } from "@microsoft/vscode-azext-azureauth";
import { uiUtils } from "@microsoft/vscode-azext-azureutils";
import { createCredential, createSubscriptionContext, IActionContext } from "@microsoft/vscode-azext-utils";
import { AzureSubscription } from "api/src/resources/azure";
import { getDuplicateSubscriptionModeSetting } from "../commands/accounts/selectSubscriptions";
import { ext } from "../extensionVariables";
import { createResourceClient } from "../utils/azureClients";

export interface AzureResourcesService {
    listResources(context: IActionContext, subscription: AzureSubscription): Promise<GenericResource[]>;
    listResourceGroups(context: IActionContext, subscription: AzureSubscription): Promise<ResourceGroup[]>;
}

export const defaultAzureResourcesServiceFactory = (): AzureResourcesService => {
    async function createClient(context: IActionContext, subscription: AzureSubscription): Promise<ResourceManagementClient> {
        // If there are duplicate subscriptions in the same account we need to directly call getSessionFromVSCode with the tenantId to ensure we get the correct session
        const duplicateSubsMode: boolean = getDuplicateSubscriptionModeSetting();
        if (duplicateSubsMode) {
            const session = await getSessionFromVSCode(undefined, subscription.tenantId, { createIfNone: false, silent: true, account: subscription.account });
            const credential = createCredential(() => session);
            return new ResourceManagementClient(credential, subscription.subscriptionId);
        } else {
            const subContext = createSubscriptionContext(subscription);
            return await createResourceClient([context, subContext]);
        }
    }
    return {
        async listResources(context: IActionContext, subscription: AzureSubscription): Promise<GenericResource[]> {
            const client = await createClient(context, subscription);
            return uiUtils.listAllIterator(client.resources.list());
        },
        async listResourceGroups(context: IActionContext, subscription: AzureSubscription): Promise<ResourceGroup[]> {
            const client = await createClient(context, subscription);
            return uiUtils.listAllIterator(client.resourceGroups.list());
        },
    };
};

export type AzureResourcesServiceFactory = () => AzureResourcesService;

export function getAzureResourcesService(): AzureResourcesService {
    return ext.testing.overrideAzureServiceFactory?.() ?? defaultAzureResourcesServiceFactory();
}
