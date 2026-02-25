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

/**
 * TTL cache for subscription-level resource lists.
 * Avoids redundant ARM calls when multiple callers (DefaultAzureResourceProvider,
 * ManagedIdentityItem, etc.) request the same resource list within a short window.
 */
const resourceListCache = new Map<string, { data: GenericResource[]; expiresAt: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

function getCachedResources(subscriptionId: string): GenericResource[] | undefined {
    const entry = resourceListCache.get(subscriptionId);
    if (entry && Date.now() < entry.expiresAt) {
        return entry.data;
    }
    // Expired or missing — clean up
    resourceListCache.delete(subscriptionId);
    return undefined;
}

function setCachedResources(subscriptionId: string, data: GenericResource[]): void {
    resourceListCache.set(subscriptionId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Invalidate resource list caches. Call on manual refresh or when resources change.
 */
export function invalidateResourceListCache(subscriptionId?: string): void {
    if (subscriptionId) {
        resourceListCache.delete(subscriptionId);
    } else {
        resourceListCache.clear();
    }
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
            // Check TTL cache first to avoid duplicate ARM calls across callers
            const cached = getCachedResources(subscription.subscriptionId);
            if (cached) {
                return cached;
            }

            const client = await createClient(context, subscription);
            const result = await uiUtils.listAllIterator(client.resources.list());
            setCachedResources(subscription.subscriptionId, result);
            return result;
        },
        async listResourceGroups(context: IActionContext, subscription: AzureSubscription): Promise<ResourceGroup[]> {
            const client = await createClient(context, subscription);
            return uiUtils.listAllIterator(client.resourceGroups.list());
        },
    };
};

export type AzureResourcesServiceFactory = () => AzureResourcesService;

/**
 * Singleton service instance. Avoids creating a new factory/closure on every call.
 */
let cachedService: AzureResourcesService | undefined;

export function getAzureResourcesService(): AzureResourcesService {
    if (ext.testing.overrideAzureServiceFactory) {
        return ext.testing.overrideAzureServiceFactory();
    }
    if (!cachedService) {
        cachedService = defaultAzureResourcesServiceFactory();
    }
    return cachedService;
}
