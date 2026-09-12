/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Uri } from "vscode";
import { DEPLOY_PREREQUISITE_CATALOG, type DeployPrerequisiteId } from "../../views/utils/deployPrerequisiteCatalog";
import { type DeploymentPrerequisite } from "../../views/utils/deploymentPlanTypes";

/**
 * The deploy stage's prerequisite record is *ours*, not the vendored Azure App Onboard pipeline's. The
 * agent runs the version probes and reports the result through the `record_deploy_prerequisites` MCP tool;
 * we keep it in memory, keyed by the owning `prepare-plan.json`, and the deploy plan view reads it back.
 * Nothing is written to disk, so we never sit beside or mutate the vendored session artifacts. The status
 * is intentionally ephemeral: if the window reloads before the agent re-reports, the view falls back to its
 * "unknown" state and the user can re-run the probe from the section's refresh button.
 */
const recordedPrerequisites = new Map<string, DeploymentPrerequisite[]>();

/** A single tool's detection result as reported by the `record_deploy_prerequisites` tool. */
interface DeployPrerequisiteInput {
    id: DeployPrerequisiteId;
    /** True when the agent positively detected the CLI; anything else is treated as unknown. */
    installed: boolean;
    version?: string;
}

/**
 * Turns the agent's raw per-tool report into the canonical, fully-populated prerequisite list the
 * view renders. Every catalog tool is always present and in catalog order, so the section is stable
 * even when the agent reports only one tool (or none). Unknown ids are ignored, and versions are
 * sanitized to a short single-line token so nothing odd leaks into the view.
 */
export function normalizeDeployPrerequisites(inputs: readonly DeployPrerequisiteInput[]): DeploymentPrerequisite[] {
    const byId = new Map<DeployPrerequisiteId, DeployPrerequisiteInput>();
    for (const input of inputs) {
        // Last write wins, and only catalog ids are kept.
        if (DEPLOY_PREREQUISITE_CATALOG.some(entry => entry.id === input.id)) {
            byId.set(input.id, input);
        }
    }

    return DEPLOY_PREREQUISITE_CATALOG.map(({ id, tool }) => {
        const reported = byId.get(id);
        const version = sanitizeVersion(reported?.version);
        return {
            tool,
            installed: reported?.installed === true,
            ...(version ? { version } : {}),
        };
    });
}

/** Keeps a version string to a short, single-line token; returns undefined for empty/garbage input. */
function sanitizeVersion(value: string | undefined): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const cleaned = value.replace(/[\r\n]+/g, ' ').trim().slice(0, 40);
    return cleaned.length > 0 ? cleaned : undefined;
}

/** Records the prerequisites the agent detected for a given `prepare-plan.json`, replacing any prior record. */
export function storeDeployPrerequisites(preparePlanUri: Uri, prerequisites: readonly DeploymentPrerequisite[]): void {
    recordedPrerequisites.set(preparePlanUri.fsPath, [...prerequisites]);
}

/** Returns the prerequisites recorded for a `prepare-plan.json`, or undefined when none have been recorded. */
export function getDeployPrerequisites(preparePlanUri: Uri): DeploymentPrerequisite[] | undefined {
    const prerequisites = recordedPrerequisites.get(preparePlanUri.fsPath);
    return prerequisites && prerequisites.length > 0 ? [...prerequisites] : undefined;
}
