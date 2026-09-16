/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "crypto";
import * as vscode from "vscode";
import { ext } from "../../../../extensionVariables";

/**
 * Tracks which deployment plans the user has already approved, so reopening the Deployment
 * Plan view for a plan that was already approved renders read-only instead of offering a
 * second approval (which would re-trigger the deploy agent).
 *
 * The deployment plan is the vendored pipeline's `prepare-plan.json`, which the agent is
 * contracted **not** to let us edit — so unlike the scaffold/debug plans there is no
 * `Status: Approved` we can write into the file. Instead we record approval in the
 * extension's `workspaceState`, keyed by the plan file path and a **content hash** of the
 * exact plan that was approved. Hashing (rather than a plain boolean) makes the marker
 * self-correcting: if the user submits feedback and the agent regenerates `prepare-plan.json`,
 * the new content hashes differently, so the regenerated plan is (correctly) not-yet-approved
 * and the Approve button returns.
 */

const STATE_KEY = 'copilotOnRails.deploymentPlan.approvedHashes';
/** Bound the persisted map so a long-lived workspace can't accumulate unboundedly. */
const MAX_ENTRIES = 10;

function hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

function readMap(): Record<string, string> {
    return ext.context.workspaceState.get<Record<string, string>>(STATE_KEY) ?? {};
}

/** Records that the plan at `uri` with the given content was approved by the user. */
export async function recordDeploymentPlanApproved(uri: vscode.Uri, content: string): Promise<void> {
    const map = readMap();
    // Re-insert at the end so pruning keeps the most-recently-approved plans.
    delete map[uri.fsPath];
    map[uri.fsPath] = hashContent(content);
    const entries = Object.entries(map);
    const pruned = entries.length > MAX_ENTRIES ? Object.fromEntries(entries.slice(-MAX_ENTRIES)) : map;
    await ext.context.workspaceState.update(STATE_KEY, pruned);
}

/** True when the plan at `uri` with exactly this content has already been approved. */
export function isDeploymentPlanApproved(uri: vscode.Uri, content: string): boolean {
    return readMap()[uri.fsPath] === hashContent(content);
}
