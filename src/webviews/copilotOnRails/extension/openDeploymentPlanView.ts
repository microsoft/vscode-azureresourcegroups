/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import { createProjectPlanFileWatcher, findProjectFiles, PREPARE_PLAN_FILE_GLOBS } from "../../../tree/project/projectPlanFiles";
import type { DeploymentPlanData, DeploymentPrerequisite } from "../views/utils/deploymentPlanTypes";
import { getPreparePlanRenderIssue, parsePreparePlanJson } from "../views/utils/parsePreparePlanJson";
import { DeploymentPlanViewController } from "./controllers/DeploymentPlanViewController";
import { closeLoadingView } from "./openLoadingView";
import { getAvailableAzureLocations } from "./utils/azureLocations";
import { getDeployPrerequisites, storeDeployPrerequisites } from "./utils/deployPrerequisites";
import { buildParseError, readFileText, SingletonViewHost, watchSingleFile } from "./utils/singletonViewHost";

const host = new SingletonViewHost<DeploymentPlanData, DeploymentPlanViewController>({
    createController: (data, uri) => {
        closeLoadingView();
        return new DeploymentPlanViewController(data, uri);
    },
    updateController: (controller, data, uri) => controller.updateDeploymentPlanData(data, uri),
});

export function isDeploymentPlanViewOpen(): boolean {
    return host.isOpen;
}

export function openDeploymentPlanView(uri: vscode.Uri): void {
    void openDeploymentPlanViewAsync(uri);
}

export function openDeploymentPlanViewWithContent(content: string, sourceFileUri?: vscode.Uri, prerequisites?: DeploymentPrerequisite[]): void {
    void openDeploymentPlanViewWithContentAsync(content, sourceFileUri, prerequisites);
}

async function openDeploymentPlanViewWithContentAsync(content: string, sourceFileUri?: vscode.Uri, prerequisites?: DeploymentPrerequisite[]): Promise<void> {
    const planData = tryParseDeploymentPlan(content, sourceFileUri);

    if (prerequisites && prerequisites.length > 0) {
        planData.prerequisites = prerequisites;
    }

    const locations = await getAvailableAzureLocations();
    if (locations.status === 'loaded') {
        planData.availableLocations = locations.locations;
    } else {
        planData.locationsUnavailable = locations.status;
    }

    host.show(planData, sourceFileUri);
}


/** Parses the structured `prepare-plan.json` artifact emitted by the azure-deploy prepare phase. */
function tryParseDeploymentPlan(content: string, sourceFileUri: vscode.Uri | undefined): DeploymentPlanData {
    let parsed: DeploymentPlanData | undefined;
    let errorMessage: string | undefined;
    try {
        parsed = parsePreparePlanJson(content);
    } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
    }

    const renderIssue = getPreparePlanRenderIssue(content, parsed);
    if (errorMessage || !parsed || renderIssue) {
        const renderIssueMessage = renderIssue === 'empty'
            ? vscode.l10n.t('The deployment plan file is empty. Copilot may still be generating it. This view will reload automatically when the file changes.')
            : renderIssue === 'invalidJson'
                ? vscode.l10n.t('The deployment plan file isn\u2019t valid JSON yet. Copilot may still be writing it. This view will reload automatically when the file changes.')
                : vscode.l10n.t('The deployment plan doesn\u2019t list any Azure services yet. This view will reload automatically when the file changes.');
        return {
            ...(parsed ?? emptyPlanData()),
            parseError: buildParseError(errorMessage ?? renderIssueMessage, sourceFileUri),
        };
    }
    return parsed;
}

function emptyPlanData(): DeploymentPlanData {
    return {
        location: '',
        locationCode: '',
        resources: { headers: [], rows: [] },
    };
}

export async function openDeploymentPlanViewFromWorkspace(_context: CopilotOnRailsContext): Promise<void> {
    const preparePlan = await findLatestPreparePlan();
    if (!preparePlan) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No deployment plan found in the workspace.'));
        return;
    }
    await openDeploymentPlanViewAsync(preparePlan);
}

/**
 * Returns the most recently modified `prepare-plan.json` across every location the deploy agent
 * writes one to.
 */
async function findLatestPreparePlan(): Promise<vscode.Uri | undefined> {
    // Resolved against the file system rather than the search index: the deploy agent git-ignores
    // `.copilot-azure/`, and `vscode.workspace.findFiles` skips git-ignored files by default.
    const matches = await Promise.all(PREPARE_PLAN_FILE_GLOBS.map(glob => findProjectFiles(glob)));
    const files = matches.flat();

    let latest: { uri: vscode.Uri; mtime: number } | undefined;
    for (const uri of files) {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (!latest || stat.mtime > latest.mtime) {
                latest = { uri, mtime: stat.mtime };
            }
        } catch {
            // The file may have been removed between the glob and the stat; skip it.
        }
    }
    return latest?.uri;
}

async function openDeploymentPlanViewAsync(uri: vscode.Uri): Promise<void> {
    const prerequisites = getDeployPrerequisites(uri);
    openDeploymentPlanViewWithContent(await readFileText(uri), uri, prerequisites);
    host.setWatcher(watchSingleFile(uri, () => void reloadDeploymentPlan(uri)));
}

async function reloadDeploymentPlan(uri: vscode.Uri): Promise<void> {
    try {
        const prerequisites = getDeployPrerequisites(uri);
        openDeploymentPlanViewWithContent(await readFileText(uri), uri, prerequisites);
    } catch {
        // File may have been deleted or be momentarily unavailable; ignore.
    }
}

/**
 * Records, in memory, the deploy prerequisites the `record_deploy_prerequisites` MCP tool collected for the
 * most recent `prepare-plan.json`, and refreshes the plan view when it is already open so the freshly
 * detected azd/az status replaces the "unknown" fallback. Returns false when no plan exists yet.
 */
export async function recordDeployPrerequisites(prerequisites: DeploymentPrerequisite[]): Promise<boolean> {
    const preparePlan = await findLatestPreparePlan();
    if (!preparePlan) {
        return false;
    }
    storeDeployPrerequisites(preparePlan, prerequisites);
    if (isDeploymentPlanViewOpen()) {
        await openDeploymentPlanViewAsync(preparePlan);
    }
    return true;
}

/**
 * Auto-open the deployment plan view when a `prepare-plan.json` first appears in the workspace.
 *
 * The deploy agent is asked to call `open_deploy_plan_view` at its scaffold approval gate, but the
 * view is the user's only visual summary of the plan, so this watcher guarantees it surfaces even
 * when the agent skips the tool call. Only creation opens the view — later writes (quota results,
 * plan edits) refresh it through {@link watchSingleFile} when it is already open, so a view the
 * user deliberately closed never pops back up mid-pipeline.
 */
export function registerDeploymentPlanAutoOpen(context: vscode.ExtensionContext): void {
    for (const glob of PREPARE_PLAN_FILE_GLOBS) {
        const watcher = createProjectPlanFileWatcher(glob);
        watcher.onDidCreate((uri) => {
            if (isDeploymentPlanViewOpen()) {
                // Already open — the per-file watcher handles content reload.
                return;
            }
            void openDeploymentPlanViewAsync(uri);
        });
        context.subscriptions.push(watcher);
    }
}
