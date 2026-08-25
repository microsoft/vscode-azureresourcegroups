/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { DEPLOY_PREREQUISITE_CATALOG, type DeployPrerequisiteId } from "../../views/utils/deployPrerequisiteCatalog";
import { type DeploymentPrerequisite } from "../../views/utils/deploymentPlanTypes";

/**
 * The deploy stage's prerequisite record is *ours*, not the vendored Azure App Onboard
 * pipeline's. The agent runs the version probes and reports the result through the
 * `record_deploy_prerequisites` MCP tool; we persist it to this sibling file next to
 * `prepare-plan.json` (inside the git-ignored `.copilot-azure/` session dir), and the
 * deploy plan view reads it. Keeping it out of `prepare-plan.json` means we never mutate
 * a vendored artifact/schema (which a vendor sync would overwrite) or touch their telemetry.
 */
const DEPLOY_PREREQUISITES_FILE_NAME = 'deploy-prerequisites.json';

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

/** The `deploy-prerequisites.json` sibling that pairs with a given `prepare-plan.json`. */
function deployPrerequisitesUriFor(preparePlanUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(preparePlanUri, '..', DEPLOY_PREREQUISITES_FILE_NAME);
}

/** Persists the recorded prerequisites next to their `prepare-plan.json`. */
export async function writeDeployPrerequisites(preparePlanUri: vscode.Uri, prerequisites: readonly DeploymentPrerequisite[]): Promise<void> {
    const uri = deployPrerequisitesUriFor(preparePlanUri);
    const content = `${JSON.stringify({ prerequisites }, undefined, 2)}\n`;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
}

/** Reads previously recorded prerequisites for a `prepare-plan.json`, or undefined when none/invalid. */
export async function readDeployPrerequisites(preparePlanUri: vscode.Uri): Promise<DeploymentPrerequisite[] | undefined> {
    try {
        const bytes = await vscode.workspace.fs.readFile(deployPrerequisitesUriFor(preparePlanUri));
        const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
        return parseStoredPrerequisites(parsed);
    } catch {
        // Missing file, unreadable, or invalid JSON - the view falls back to an "unknown" list.
        return undefined;
    }
}

/** Defensively reads back our own stored shape, tolerating hand-edits without trusting them. */
function parseStoredPrerequisites(parsed: unknown): DeploymentPrerequisite[] | undefined {
    const list = (parsed as { prerequisites?: unknown })?.prerequisites;
    if (!Array.isArray(list)) {
        return undefined;
    }
    const prerequisites = list
        .map((entry): DeploymentPrerequisite | undefined => {
            const record = entry as { tool?: unknown; installed?: unknown; version?: unknown };
            const tool = typeof record.tool === 'string' ? record.tool.trim() : '';
            if (!tool) {
                return undefined;
            }
            const version = sanitizeVersion(typeof record.version === 'string' ? record.version : undefined);
            return { tool, installed: record.installed === true, ...(version ? { version } : {}) };
        })
        .filter((entry): entry is DeploymentPrerequisite => entry !== undefined);
    return prerequisites.length > 0 ? prerequisites : undefined;
}
