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
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import { captureInventory, resolveSubscription, snapshotResourceIds } from "../../../utils/copilotOnRails/deploymentInventoryCapture";
import { callWithDiagnosticsAndTelemetryHandling, setCorErrorProp, setCorProp } from "../../../utils/copilotOnRails/telemetryUtils";

const captureDeploymentInventoryToolName = 'capture_deployment_inventory';

/**
 * Baseline snapshots per session, held in memory (keyed by sessionId) so the capture phase can
 * diff against it without writing any artifact to the user's workspace. The extension host stays
 * alive across the deploy phase's tool calls, so this survives the baseline → capture round-trip.
 */
const baselineBySession = new Map<string, string[]>();

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
    description: 'Deterministically record the Azure resources a deployment created by diffing a resources.list() snapshot taken before the first deployment against one taken after each attempt. Call with phase="baseline" before deploying, then phase="capture" after each attempt and on failure. The capture returns the created resources classified as expected/failed/orphaned/unverified. Only "failed" resources are confirmed to belong to this deployment; "orphaned" means the resource appeared during the deploy window but could not be attributed to it, and "unverified" means attribution was impossible — never describe either as safe to delete. Report-only — never deletes, never writes to disk.',
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

    if (input.phase === 'baseline') {
        const baseline = await snapshotResourceIds(context, subscription);
        baselineBySession.set(input.sessionId, baseline);
        setCorProp(context, 'captureBaselineCount', baseline.length);
        return { message: vscode.l10n.t('Baseline captured: {0} existing resource(s). Run phase="capture" after each deployment attempt.', baseline.length) };
    }

    const baseline = baselineBySession.get(input.sessionId);
    setCorProp(context, 'captureMissingBaseline', baseline === undefined);

    const result = await captureInventory(context, subscription, {
        expectedResourceGroup: input.expectedResourceGroup,
        deploymentNames: input.deploymentNames,
        resourceGroups: input.resourceGroups,
        baseline,
    });

    setCorProp(context, 'captureCreatedCount', result.createdResources.length);
    setCorProp(context, 'captureTargetsUnavailable', result.targetsUnavailable === true);

    // The deployment operations were unreadable, so nothing can be attributed. Returning an
    // "orphaned" list here would be a guess the agent would faithfully write into
    // deploy-result.json as fact — and the user would be handed delete commands for a working app.
    if (result.targetsUnavailable) {
        setCorErrorProp(context, 'captureTargetsUnavailableReason', result.targetsUnavailableReason ?? 'error');
        const reasonHint = result.targetsUnavailableReason === 'forbidden'
            ? vscode.l10n.t('The signed-in account lacks permission to read deployment operations (Microsoft.Resources/deployments/operations/read).')
            : vscode.l10n.t('Reading the deployment operations failed (reason: {0}).', result.targetsUnavailableReason ?? 'error');
        return {
            message: vscode.l10n.t('Could not verify which resources this deployment created. {0} Record this in deploy-result.json as an unverified inventory and do NOT present any resource as safe to delete. Tell the user the deployment created {1} resource(s) that could not be attributed, and that they should review the resource group in the Azure portal.', reasonHint, result.createdResources.length),
            createdResources: result.createdResources,
            orphanedResourceGroups: [],
            hasCleanupConcerns: false,
            inventoryUnverified: true,
            inventoryUnverifiedReason: result.targetsUnavailableReason ?? 'error',
        };
    }

    const failed = result.createdResources.filter((r) => r.classification === 'failed').length;
    const orphaned = result.createdResources.filter((r) => r.classification === 'orphaned').length;
    setCorProp(context, 'captureFailedCount', failed);
    setCorProp(context, 'captureOrphanCount', orphaned);

    const summary = vscode.l10n.t(
        'Captured {0} new resource(s): {1} expected, {2} failed, {3} unattributed. Write createdResources[] and orphanedResourceGroups[] into deploy-result.json. Only the "failed" entries are confirmed to belong to this deployment; the "orphaned" ones merely appeared during the deploy window, so describe them as needing review rather than as safe to delete.',
        result.createdResources.length, result.createdResources.length - failed - orphaned, failed, orphaned,
    );
    const baselineNote = baseline === undefined
        ? ' ' + vscode.l10n.t('Warning: no baseline was found, so only resources reported by the tracked deployment(s) are listed. Run phase="baseline" before deploying next time to also catch imperative strays.')
        : '';

    return {
        message: summary + baselineNote,
        // Structured result for the agent to persist into deploy-result.json.
        createdResources: result.createdResources,
        orphanedResourceGroups: result.orphanedResourceGroups,
        hasCleanupConcerns: result.hasCleanupConcerns,
    };
}

