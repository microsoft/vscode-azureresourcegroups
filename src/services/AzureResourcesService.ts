/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeploymentOperation, GenericResource, ResourceGroup, ResourceManagementClient } from "@azure/arm-resources";
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
    /**
     * Lists the ARM deployment operations for a single deployment. Used by the
     * deployment inventory capture to determine, deterministically, which resource
     * IDs an ARM deployment reported and their provisioning states.
     *
     * When `resourceGroupName` is provided the operations are read at
     * resource-group scope; otherwise they are read at subscription scope (used
     * for `az deployment sub create`). A missing deployment resolves to an empty
     * list rather than throwing, so callers can tolerate not-yet-created or
     * already-deleted deployments.
     */
    listDeploymentOperations(context: IActionContext, subscription: AzureSubscription, deploymentName: string, resourceGroupName?: string): Promise<DeploymentOperation[]>;
}

export const defaultAzureResourcesServiceFactory = (): AzureResourcesService => {
    async function createClient(context: IActionContext, subscription: AzureSubscription): Promise<ResourceManagementClient> {
        // If there are duplicate subscriptions in the same account we need to directly call getSessionFromVSCode with the tenantId to ensure we get the correct session
        const duplicateSubsMode: boolean = getDuplicateSubscriptionModeSetting();
        const subContext = createSubscriptionContext(subscription);
        if (duplicateSubsMode) {
            const session = await getSessionFromVSCode(undefined, subscription.tenantId, { createIfNone: false, silent: true, account: subscription.account });
            subContext.credentials = createCredential(() => session);
        }
        return await createResourceClient([context, subContext]);
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
        async listDeploymentOperations(context: IActionContext, subscription: AzureSubscription, deploymentName: string, resourceGroupName?: string): Promise<DeploymentOperation[]> {
            const client = await createClient(context, subscription);
            try {
                const iterator = resourceGroupName
                    ? client.deploymentOperations.list(resourceGroupName, deploymentName)
                    : client.deploymentOperations.listAtSubscriptionScope(deploymentName);
                return await uiUtils.listAllIterator(iterator);
            } catch {
                // A deployment name that was never created (or already removed) yields
                // an error we treat as "no operations" so capture can proceed.
                return [];
            }
        },
    };
};

export type AzureResourcesServiceFactory = () => AzureResourcesService;

export function getAzureResourcesService(): AzureResourcesService {
    return ext.testing.overrideAzureServiceFactory?.() ?? defaultAzureResourcesServiceFactory();
}
