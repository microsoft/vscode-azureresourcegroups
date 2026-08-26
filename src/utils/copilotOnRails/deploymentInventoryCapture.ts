/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import type { AzureSubscription } from "api/src/resources/azure";
import { ext } from "../../extensionVariables";
import { AzureResourcesService, DeploymentOperationsUnavailableReason, getAzureResourcesService } from "../../services/AzureResourcesService";
import { computeDeploymentInventory, DeploymentInventoryResult, DeploymentTarget, normalizeResourceId } from "./deploymentInventory";

/**
 * Azure-facing side of the deterministic deployment inventory. Kept separate from the pure
 * {@link computeDeploymentInventory} logic (which has no `vscode`/SDK imports) so it can be shared
 * by both the agent-invoked `capture_deployment_inventory` MCP tool and the extension-owned
 * deploy-result watcher — the latter is what guarantees the inventory is computed even when the
 * agent never calls the tool.
 */

export interface CaptureInventoryOptions {
    /** Final target resource group; created resources outside it are flagged as orphaned. */
    expectedResourceGroup?: string;
    /** ARM deployment names (initial + healing) used to classify created resources. */
    deploymentNames?: readonly string[];
    /** Resource groups the deployments targeted, so RG-scoped operations can be read. */
    resourceGroups?: readonly string[];
    /**
     * Resource IDs snapshotted before provisioning began. When omitted, the capture falls back to a
     * deployment-operations-only inventory: it reports only the resources the tracked ARM
     * deployment(s) touched. That fallback can't detect imperative `az` strays (there is no
     * before/after diff), but it never over-reports pre-existing resources as newly created.
     */
    baseline?: readonly string[];
}

export interface CollectDeploymentTargetsResult {
    targets: DeploymentTarget[];
    /**
     * Set when at least one tracked deployment's operations could not be read. The inventory then
     * cannot attribute created resources and must not suggest cleanup.
     */
    unavailable?: DeploymentOperationsUnavailableReason;
}

/** Resolve an `AzureSubscription` by ID, or `undefined` when it isn't available (e.g. signed out). */
export async function resolveSubscription(subscriptionId: string): Promise<AzureSubscription | undefined> {
    const provider = await ext.subscriptionProviderFactory();
    const subscriptions = await provider.getAvailableSubscriptions({ filter: false });
    return subscriptions.find((s) => s.subscriptionId === subscriptionId);
}

/** Snapshot the subscription's current resource IDs (de-duplicated) for use as an inventory baseline. */
export async function snapshotResourceIds(context: IActionContext, subscription: AzureSubscription, service: AzureResourcesService = getAzureResourcesService()): Promise<string[]> {
    const resources = await service.listResources(context, subscription);
    return dedupeResourceIds(resources);
}

export function dedupeResourceIds(resources: readonly { id?: string }[]): string[] {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const resource of resources) {
        if (resource.id && !seen.has(normalizeResourceId(resource.id))) {
            seen.add(normalizeResourceId(resource.id));
            ids.push(resource.id);
        }
    }
    return ids;
}

/** Reads ARM deployment operations for the tracked deployments to learn which created resources
 *  each deployment accounts for and their provisioning states. */
export async function collectDeploymentTargets(context: IActionContext, subscription: AzureSubscription, options: CaptureInventoryOptions, service: AzureResourcesService = getAzureResourcesService()): Promise<CollectDeploymentTargetsResult> {
    const deploymentNames = options.deploymentNames ?? [];
    if (deploymentNames.length === 0) {
        return { targets: [] };
    }
    // A deployment may live at subscription scope or (after a 403 fallback) at RG scope.
    const scopes: (string | undefined)[] = [undefined, ...(options.resourceGroups ?? [])];
    const byId = new Map<string, DeploymentTarget>();
    let unavailable: DeploymentOperationsUnavailableReason | undefined;

    for (const deploymentName of deploymentNames) {
        // A deployment only lives at one scope, so the other scope legitimately 404s. Only treat
        // the deployment as unreadable when *no* scope produced an answer.
        let readAnyScope = false;
        let scopeFailure: DeploymentOperationsUnavailableReason | undefined;

        for (const scope of scopes) {
            const { operations, unavailable: scopeUnavailable } = await service.listDeploymentOperations(context, subscription, deploymentName, scope);
            if (scopeUnavailable) {
                // 'forbidden' is the most actionable reason, so let it win over a transient one.
                if (scopeFailure === undefined || scopeUnavailable === 'forbidden') {
                    scopeFailure = scopeUnavailable;
                }
                continue;
            }
            readAnyScope = true;
            for (const op of operations) {
                const id = op.properties?.targetResource?.id;
                if (!id) {
                    continue;
                }
                const normalized = normalizeResourceId(id);
                const provisioningState = op.properties?.provisioningState;
                // Prefer a succeeded state if any scope reports one.
                if (!byId.has(normalized) || provisioningState?.toLowerCase() === 'succeeded') {
                    byId.set(normalized, { id, provisioningState });
                }
            }
        }

        if (!readAnyScope && scopeFailure !== undefined && (unavailable === undefined || scopeFailure === 'forbidden')) {
            unavailable = scopeFailure;
        }
    }
    return unavailable ? { targets: Array.from(byId.values()), unavailable } : { targets: Array.from(byId.values()) };
}

/**
 * Computes the deterministic deployment inventory for a subscription: lists the current resources,
 * reads the tracked deployment operations, and diffs against the baseline. When no baseline is
 * available it degrades gracefully to a deployment-operations-only inventory (see
 * {@link CaptureInventoryOptions.baseline}).
 *
 * When the deployment operations could not be read at all, the result is marked
 * {@link DeploymentInventoryResult.targetsUnavailable} and suggests no cleanup — see
 * {@link computeDeploymentInventory}.
 */
export async function captureInventory(context: IActionContext, subscription: AzureSubscription, options: CaptureInventoryOptions, service: AzureResourcesService = getAzureResourcesService()): Promise<DeploymentInventoryResult> {
    const resources = await service.listResources(context, subscription);
    const post = resources.map((r) => ({ id: r.id ?? '', name: r.name, type: r.type })).filter((r) => r.id);
    const { targets: deploymentTargets, unavailable } = await collectDeploymentTargets(context, subscription, options, service);
    const computeOptions = { targetsUnavailable: unavailable !== undefined };
    const withReason = (result: DeploymentInventoryResult): DeploymentInventoryResult =>
        unavailable ? { ...result, targetsUnavailableReason: unavailable } : result;

    if (options.baseline) {
        return withReason(computeDeploymentInventory(options.baseline, post, deploymentTargets, options.expectedResourceGroup, computeOptions));
    }

    // No baseline: restrict the "post" set to just the tracked deployment targets so pre-existing
    // resources are never mistaken for newly created ones.
    const targetIds = new Set(deploymentTargets.map((t) => normalizeResourceId(t.id)));
    const targetsAsPost = post.filter((r) => targetIds.has(normalizeResourceId(r.id)));
    return withReason(computeDeploymentInventory([], targetsAsPost, deploymentTargets, options.expectedResourceGroup, computeOptions));
}
