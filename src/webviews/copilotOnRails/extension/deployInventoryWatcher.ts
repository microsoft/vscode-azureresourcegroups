/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtFsExtra, callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { createProjectPlanFileWatcher, DEPLOY_RESULT_FILE_GLOBS, findProjectFiles } from "../../../tree/project/projectPlanFiles";
import { captureInventory, resolveSubscription, snapshotResourceIds } from "../../../utils/copilotOnRails/deploymentInventoryCapture";
import { CreatedResource, OrphanedResourceGroup } from "../../../utils/copilotOnRails/deploymentInventory";

/**
 * Extension-owned safety net that guarantees the deterministic deployment inventory is computed for
 * every deploy — without depending on the agent choosing to call the `capture_deployment_inventory`
 * MCP tool (an LLM tool-call is never a hard guarantee, which matters here for security: users must
 * always be shown the resources a deploy created so nothing is silently left behind).
 *
 * It watches `deploy-result.json` (the artifact the whole deploy pipeline already requires) and:
 *   - on the first `status: "in-progress"` write, snapshots the subscription's resources as the
 *     inventory baseline (persisted in `workspaceState`, so it survives a window reload mid-deploy);
 *   - on the terminal (`succeeded`/`failed`) write, computes the created/orphaned inventory and
 *     writes `createdResources[]`/`orphanedResourceGroups[]` back into the file — but only when the
 *     agent didn't already populate them, so this stays a complementary net rather than a fight.
 *
 * The same capture is also invoked from the deploy-result view's read path (see
 * {@link ensureDeployInventoryCaptured}) so the inventory is present even if the window was closed
 * for the entire deploy and only reopened to view results.
 */

/** `workspaceState` key holding the pre-deploy baseline resource IDs for a session. */
const baselineKey = (sessionId: string): string => `copilotOnRails.deployInventory.baseline.${sessionId}`;
/** `workspaceState` key set once the terminal inventory has been captured for a session (idempotency across reloads). */
const capturedKey = (sessionId: string): string => `copilotOnRails.deployInventory.captured.${sessionId}`;

let extensionContext: vscode.ExtensionContext | undefined;
const disposables: vscode.Disposable[] = [];

/** In-flight guards so overlapping create/change events can't double-snapshot or double-capture a session. */
const baseliningSessions = new Set<string>();
const capturingSessions = new Set<string>();

interface DeployResultFields {
    sessionId: string;
    subscriptionId: string;
    status: string;
    resourceGroupName: string;
    deploymentNames: string[];
    raw: Record<string, unknown>;
}

export function registerDeployInventoryWatcher(context: vscode.ExtensionContext): void {
    extensionContext = context;
    for (const glob of DEPLOY_RESULT_FILE_GLOBS) {
        const watcher = createProjectPlanFileWatcher(glob);
        watcher.onDidCreate((uri) => void handleDeployResultFile(uri));
        watcher.onDidChange((uri) => void handleDeployResultFile(uri));
        disposables.push(watcher);
    }
    context.subscriptions.push({ dispose: () => disposeWatcher() });
    // A deploy may already be in flight (or finished) when the window (re)loads — reconcile now.
    void syncToCurrentState();
}

function disposeWatcher(): void {
    for (const disposable of disposables.splice(0)) {
        disposable.dispose();
    }
}

/**
 * View-path guarantee: ensure the terminal inventory has been captured for the given
 * `deploy-result.json` before it is displayed. No-op when the file isn't terminal yet or the
 * inventory is already present.
 */
export async function ensureDeployInventoryCaptured(uri: vscode.Uri): Promise<void> {
    await handleDeployResultFile(uri);
}

async function syncToCurrentState(): Promise<void> {
    const uris = (await Promise.all(DEPLOY_RESULT_FILE_GLOBS.map((glob) => findProjectFiles(glob)))).flat();
    await Promise.all(uris.map((uri) => handleDeployResultFile(uri)));
}

async function handleDeployResultFile(uri: vscode.Uri): Promise<void> {
    await callWithTelemetryAndErrorHandling('copilotOnRails.deployInventoryWatcher', async (context: IActionContext) => {
        // A background watcher must never surface error toasts for transient Azure/list failures.
        context.errorHandling.suppressDisplay = true;
        context.telemetry.suppressIfSuccessful = true;

        const fields = await readDeployResultFields(uri);
        if (!fields) {
            return;
        }

        if (fields.status === 'in-progress') {
            await ensureBaselineCaptured(context, fields);
        } else if (fields.status === 'succeeded' || fields.status === 'failed') {
            await ensureInventoryCaptured(context, uri, fields);
        }
    });
}

async function readDeployResultFields(uri: vscode.Uri): Promise<DeployResultFields | undefined> {
    let raw: Record<string, unknown>;
    try {
        const parsed: unknown = JSON.parse(await AzExtFsExtra.readFile(uri));
        if (typeof parsed !== 'object' || parsed === null) {
            return undefined;
        }
        raw = parsed as Record<string, unknown>;
    } catch {
        // Momentary partial write or invalid JSON; a later change event will re-trigger.
        return undefined;
    }

    const sessionId = readString(raw.sessionId);
    const subscriptionId = readString(raw.subscriptionId);
    const status = readString(raw.status).toLowerCase();
    if (!sessionId || !subscriptionId || !status) {
        return undefined;
    }

    return {
        sessionId,
        subscriptionId,
        status,
        resourceGroupName: readString(raw.resourceGroupName),
        deploymentNames: Array.isArray(raw.deploymentNames) ? raw.deploymentNames.filter((n): n is string => typeof n === 'string') : [],
        raw,
    };
}

async function ensureBaselineCaptured(context: IActionContext, fields: DeployResultFields): Promise<void> {
    const context$ = extensionContext;
    if (!context$) {
        return;
    }
    const key = baselineKey(fields.sessionId);
    if (context$.workspaceState.get(key) !== undefined || baseliningSessions.has(fields.sessionId)) {
        return;
    }
    baseliningSessions.add(fields.sessionId);
    try {
        const subscription = await resolveSubscription(fields.subscriptionId);
        if (!subscription) {
            return;
        }
        const resourceIds = await snapshotResourceIds(context, subscription);
        await context$.workspaceState.update(key, resourceIds);
    } finally {
        baseliningSessions.delete(fields.sessionId);
    }
}

async function ensureInventoryCaptured(context: IActionContext, uri: vscode.Uri, fields: DeployResultFields): Promise<void> {
    const context$ = extensionContext;
    if (!context$) {
        return;
    }
    if (context$.workspaceState.get(capturedKey(fields.sessionId)) === true) {
        return;
    }
    // Respect an inventory the agent already wrote — this net only fills the gap when it didn't.
    if (Array.isArray(fields.raw.createdResources) && fields.raw.createdResources.length > 0) {
        await context$.workspaceState.update(capturedKey(fields.sessionId), true);
        return;
    }
    if (capturingSessions.has(fields.sessionId)) {
        return;
    }
    capturingSessions.add(fields.sessionId);
    try {
        const subscription = await resolveSubscription(fields.subscriptionId);
        if (!subscription) {
            // Signed out — leave uncaptured so a later event (or view open) retries once signed in.
            return;
        }
        const baseline = context$.workspaceState.get<string[]>(baselineKey(fields.sessionId));
        const expectedResourceGroup = fields.resourceGroupName || undefined;
        const result = await captureInventory(context, subscription, {
            expectedResourceGroup,
            deploymentNames: fields.deploymentNames,
            resourceGroups: expectedResourceGroup ? [expectedResourceGroup] : undefined,
            baseline,
        });

        await writeInventoryIntoFile(uri, fields.raw, result.createdResources, result.orphanedResourceGroups, expectedResourceGroup);
        await context$.workspaceState.update(capturedKey(fields.sessionId), true);
    } finally {
        capturingSessions.delete(fields.sessionId);
    }
}

/**
 * Merge the computed inventory into the artifact, preserving every other field. `createdResources`
 * is authoritative (only written when the agent left it empty); orphaned resource groups are unioned
 * with any the agent already recorded so healing-abandoned RGs aren't dropped.
 */
async function writeInventoryIntoFile(
    uri: vscode.Uri,
    raw: Record<string, unknown>,
    createdResources: readonly CreatedResource[],
    orphanedResourceGroups: readonly OrphanedResourceGroup[],
    expectedResourceGroup: string | undefined,
): Promise<void> {
    const existingOrphans = Array.isArray(raw.orphanedResourceGroups) ? raw.orphanedResourceGroups : [];
    const existingNames = new Set(
        existingOrphans
            .map((entry) => (typeof entry === 'object' && entry !== null ? readString((entry as Record<string, unknown>).name).toLowerCase() : ''))
            .filter((name) => name.length > 0),
    );
    const newOrphans = orphanedResourceGroups
        .filter((group) => !existingNames.has(group.name.toLowerCase()))
        .map((group) => ({
            name: group.name,
            reason: expectedResourceGroup
                ? `Holds ${group.resourceCount} resource(s) created by this deployment outside the target resource group "${expectedResourceGroup}".`
                : `Holds ${group.resourceCount} resource(s) created by this deployment.`,
        }));

    // Nothing was created and no new orphans — don't churn (reformat + trigger a reload of) the
    // agent's artifact for a no-op. The caller still records the capture as done.
    if (createdResources.length === 0 && newOrphans.length === 0) {
        return;
    }

    const merged: Record<string, unknown> = {
        ...raw,
        createdResources,
        orphanedResourceGroups: [...existingOrphans, ...newOrphans],
    };

    await AzExtFsExtra.writeFile(uri, JSON.stringify(merged, null, 2) + '\n');
}

function readString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}
