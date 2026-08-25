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

/**
 * Why the ARM deployment operations for a deployment could not be read. A missing deployment (404)
 * is deliberately *not* one of these — that is a legitimate empty result.
 */
export type DeploymentOperationsUnavailableReason =
    /** Caller lacks `Microsoft.Resources/deployments/operations/read` (401/403). */
    | 'forbidden'
    /** ARM throttled the request (429). */
    | 'throttled'
    /** Any other failure: 5xx, network, malformed response. */
    | 'error';

export interface DeploymentOperationsResult {
    operations: DeploymentOperation[];
    /**
     * Set when the operations could not be read at all. Callers must treat this as "unknown"
     * rather than "no operations": an empty `operations` array caused by a permission or transient
     * failure is indistinguishable from a deployment that genuinely created nothing, and
     * conflating the two makes every created resource look unattributed.
     */
    unavailable?: DeploymentOperationsUnavailableReason;
}

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
     * for `az deployment sub create`).
     *
     * A deployment that does not exist (404) resolves to an empty operation list, so callers can
     * tolerate not-yet-created or already-deleted deployments. Every other failure resolves to an
     * empty list *with* {@link DeploymentOperationsResult.unavailable} set, so callers can tell
     * "this deployment reported nothing" apart from "I could not ask".
     */
    listDeploymentOperations(context: IActionContext, subscription: AzureSubscription, deploymentName: string, resourceGroupName?: string): Promise<DeploymentOperationsResult>;
}

/**
 * Best-effort HTTP status extraction. The Azure SDK throws `RestError` (which carries
 * `statusCode`), but this reads the property structurally so a wrapped or re-thrown error still
 * classifies correctly instead of falling through to the catch-all.
 */
function getStatusCode(error: unknown): number | undefined {
    if (typeof error === 'object' && error !== null) {
        const statusCode: unknown = (error as { statusCode?: unknown }).statusCode;
        if (typeof statusCode === 'number') {
            return statusCode;
        }
    }
    return undefined;
}

function classifyDeploymentOperationsError(error: unknown): DeploymentOperationsUnavailableReason | undefined {
    switch (getStatusCode(error)) {
        case 404:
            // The deployment was never created or has already been removed. Genuinely no
            // operations — the only case that is safe to report as an empty result.
            return undefined;
        case 401:
        case 403:
            return 'forbidden';
        case 429:
            return 'throttled';
        default:
            return 'error';
    }
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
        async listDeploymentOperations(context: IActionContext, subscription: AzureSubscription, deploymentName: string, resourceGroupName?: string): Promise<DeploymentOperationsResult> {
            const client = await createClient(context, subscription);
            try {
                const iterator = resourceGroupName
                    ? client.deploymentOperations.list(resourceGroupName, deploymentName)
                    : client.deploymentOperations.listAtSubscriptionScope(deploymentName);
                return { operations: await uiUtils.listAllIterator(iterator) };
            } catch (error) {
                const unavailable = classifyDeploymentOperationsError(error);
                return unavailable ? { operations: [], unavailable } : { operations: [] };
            }
        },
    };
};

export type AzureResourcesServiceFactory = () => AzureResourcesService;

export function getAzureResourcesService(): AzureResourcesService {
    return ext.testing.overrideAzureServiceFactory?.() ?? defaultAzureResourcesServiceFactory();
}
