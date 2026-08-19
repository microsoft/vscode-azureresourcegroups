/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext, parseError } from "@microsoft/vscode-azext-utils";
import { CopilotTool } from "@microsoft/vscode-inproc-mcp";
import { UnspecifiedOutputSchema } from "@microsoft/vscode-inproc-mcp/mcp";
import type { AzureSubscription } from "api/src/resources/azure";
import * as vscode from "vscode";
import { z } from "zod/mini";
import { ext } from "../../../extensionVariables";
import { getAzureResourcesService } from "../../../services/AzureResourcesService";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import { computeDeploymentInventory, DeploymentTarget, normalizeResourceId } from "../../../utils/copilotOnRails/deploymentInventory";
import { callWithDiagnosticsAndTelemetryHandling, setCorErrorProp, setCorProp } from "../../../utils/copilotOnRails/telemetryUtils";

const captureDeploymentInventoryToolName = 'capture_deployment_inventory';

/**
 * Baseline resource IDs per session, held in memory (keyed by sessionId) so the capture phase can
 * diff against it without writing any artifact to the user's workspace. The extension host stays
 * alive across the deploy phase's tool calls, so this survives the baseline → capture round-trip.
 */
const baselineBySession = new Map<string, readonly string[]>();

const captureDeploymentInventoryInputSchema = z.object({
    /** App Onboard session id — the key the baseline is stored under. */
    sessionId: z.string(),
    /** Azure subscription the deployment targets. */
    subscriptionId: z.string(),
    /** `baseline` snapshots resources before the first deployment; `capture` diffs after each attempt. */
    phase: z.enum(['baseline', 'capture']),
    /** Final target resource group; created resources outside it are flagged as orphaned. */
    expectedResourceGroup: z.optional(z.string()),
    /** ARM deployment names (initial + healing) used to classify created resources. */
    deploymentNames: z.optional(z.array(z.string())),
    /** Resource groups the deployments targeted, so RG-scoped operations can be read. */
    resourceGroups: z.optional(z.array(z.string())),
});

type CaptureInput = z.infer<typeof captureDeploymentInventoryInputSchema>;

export const captureDeploymentInventoryTool: CopilotTool<typeof captureDeploymentInventoryInputSchema, typeof UnspecifiedOutputSchema> = {
    name: captureDeploymentInventoryToolName,
    description: 'Deterministically record the Azure resources a deployment created by diffing a resources.list() snapshot taken before the first deployment against one taken after each attempt. Call with phase="baseline" before deploying, then phase="capture" after each attempt and on failure. The capture returns the created resources classified as expected/failed/orphaned so you can write them into deploy-result.json. Report-only — never deletes, never writes to disk.',
    inputSchema: captureDeploymentInventoryInputSchema,
    annotations: {
        // Reads Azure resources (external world); holds the baseline in memory only.
        openWorldHint: true,
        readOnlyHint: true,
        destructiveHint: false,
    },
    execute: async (input, extras) => {
        return await callWithTelemetryAndErrorHandling(`mcpTool/${captureDeploymentInventoryToolName}/execute`, async (context: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(context, { type: 'mcpTool', name: captureDeploymentInventoryToolName, extras }, async (corContext) => {
                return await captureDeploymentInventory(corContext, input);
            });
        }) ?? {
            message: vscode.l10n.t('Failed to capture the deployment inventory.'),
        };
    }
};

async function captureDeploymentInventory(context: CopilotOnRailsContext, input: CaptureInput): Promise<Record<string, unknown>> {
    setCorProp(context, 'capturePhase', input.phase);

    let subscription: AzureSubscription | undefined;
    try {
        subscription = await resolveSubscription(input.subscriptionId);
    } catch (error) {
        setCorErrorProp(context, 'captureSubscriptionError', parseError(error).message);
        return { message: vscode.l10n.t('Failed to resolve Azure subscription "{0}". Ensure you are signed in.', input.subscriptionId) };
    }
    if (!subscription) {
        return { message: vscode.l10n.t('Azure subscription "{0}" was not found. Sign in or select it, then retry.', input.subscriptionId) };
    }

    const resources = await getAzureResourcesService().listResources(context, subscription);

    if (input.phase === 'baseline') {
        const resourceIds = dedupeResourceIds(resources);
        baselineBySession.set(input.sessionId, resourceIds);
        setCorProp(context, 'captureBaselineCount', resourceIds.length);
        return { message: vscode.l10n.t('Baseline captured: {0} existing resource(s). Run phase="capture" after each deployment attempt.', resourceIds.length) };
    }

    const baseline = baselineBySession.get(input.sessionId);
    setCorProp(context, 'captureMissingBaseline', baseline === undefined);

    const deploymentTargets = await collectDeploymentTargets(context, subscription, input);
    const result = computeDeploymentInventory(
        baseline ?? [],
        resources.map((r) => ({ id: r.id ?? '', name: r.name, type: r.type })).filter((r) => r.id),
        deploymentTargets,
        input.expectedResourceGroup,
    );

    const failed = result.createdResources.filter((r) => r.classification === 'failed').length;
    const orphaned = result.createdResources.filter((r) => r.classification === 'orphaned').length;
    setCorProp(context, 'captureCreatedCount', result.createdResources.length);
    setCorProp(context, 'captureFailedCount', failed);
    setCorProp(context, 'captureOrphanCount', orphaned);

    const summary = vscode.l10n.t(
        'Captured {0} new resource(s): {1} expected, {2} failed, {3} orphaned. Write createdResources[] and orphanedResourceGroups[] into deploy-result.json, and build cleanup commands from the orphaned/failed entries.',
        result.createdResources.length, result.createdResources.length - failed - orphaned, failed, orphaned,
    );
    const baselineNote = baseline === undefined
        ? ' ' + vscode.l10n.t('Warning: no baseline was found, so every current resource is treated as new. Run phase="baseline" before deploying next time.')
        : '';

    return {
        message: summary + baselineNote,
        // Structured result for the agent to persist into deploy-result.json.
        createdResources: result.createdResources,
        orphanedResourceGroups: result.orphanedResourceGroups,
        hasCleanupConcerns: result.hasCleanupConcerns,
    };
}

/** Reads ARM deployment operations for the tracked deployments to learn which created resources
 *  each deployment accounts for and their provisioning states. */
async function collectDeploymentTargets(context: IActionContext, subscription: AzureSubscription, input: CaptureInput): Promise<DeploymentTarget[]> {
    const deploymentNames = input.deploymentNames ?? [];
    if (deploymentNames.length === 0) {
        return [];
    }
    // A deployment may live at subscription scope or (after a 403 fallback) at RG scope.
    const scopes: (string | undefined)[] = [undefined, ...(input.resourceGroups ?? [])];
    const service = getAzureResourcesService();
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

function dedupeResourceIds(resources: readonly { id?: string }[]): string[] {
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

async function resolveSubscription(subscriptionId: string): Promise<AzureSubscription | undefined> {
    const provider = await ext.subscriptionProviderFactory();
    const subscriptions = await provider.getAvailableSubscriptions({ filter: false });
    return subscriptions.find((s) => s.subscriptionId === subscriptionId);
}
