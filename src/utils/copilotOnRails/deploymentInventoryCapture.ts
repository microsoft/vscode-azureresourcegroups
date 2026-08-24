/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import type { AzureSubscription } from "api/src/resources/azure";
import { ext } from "../../extensionVariables";
import { AzureResourcesService, getAzureResourcesService } from "../../services/AzureResourcesService";
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
export async function collectDeploymentTargets(context: IActionContext, subscription: AzureSubscription, options: CaptureInventoryOptions, service: AzureResourcesService = getAzureResourcesService()): Promise<DeploymentTarget[]> {
    const deploymentNames = options.deploymentNames ?? [];
    if (deploymentNames.length === 0) {
        return [];
    }
    // A deployment may live at subscription scope or (after a 403 fallback) at RG scope.
    const scopes: (string | undefined)[] = [undefined, ...(options.resourceGroups ?? [])];
    const byId = new Map<string, DeploymentTarget>();

    for (const deploymentName of deploymentNames) {
        for (const scope of scopes) {
            const operations = await service.listDeploymentOperations(context, subscription, deploymentName, scope);
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
    }
    return Array.from(byId.values());
}

/**
 * Computes the deterministic deployment inventory for a subscription: lists the current resources,
 * reads the tracked deployment operations, and diffs against the baseline. When no baseline is
 * available it degrades gracefully to a deployment-operations-only inventory (see
 * {@link CaptureInventoryOptions.baseline}).
 */
export async function captureInventory(context: IActionContext, subscription: AzureSubscription, options: CaptureInventoryOptions, service: AzureResourcesService = getAzureResourcesService()): Promise<DeploymentInventoryResult> {
    const resources = await service.listResources(context, subscription);
    const post = resources.map((r) => ({ id: r.id ?? '', name: r.name, type: r.type })).filter((r) => r.id);
    const deploymentTargets = await collectDeploymentTargets(context, subscription, options, service);

    if (options.baseline) {
        return computeDeploymentInventory(options.baseline, post, deploymentTargets, options.expectedResourceGroup);
    }

    // No baseline: restrict the "post" set to just the tracked deployment targets so pre-existing
    // resources are never mistaken for newly created ones.
    const targetIds = new Set(deploymentTargets.map((t) => normalizeResourceId(t.id)));
    const targetsAsPost = post.filter((r) => targetIds.has(normalizeResourceId(r.id)));
    return computeDeploymentInventory([], targetsAsPost, deploymentTargets, options.expectedResourceGroup);
}
