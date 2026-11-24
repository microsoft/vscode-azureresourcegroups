/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { findAppOnboardArtifact } from "../../../tree/project/findAppOnboardArtifact";
import { APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, PREPARE_PLAN_FILE_GLOBS } from "../../../tree/project/projectPlanFiles";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import type { DeploymentPlanData, DeploymentPrerequisite } from "../views/utils/deploymentPlanTypes";
import { getPreparePlanRenderIssue, parsePreparePlanJson } from "../views/utils/parsePreparePlanJson";
import { DeploymentPlanViewController } from "./controllers/DeploymentPlanViewController";
import { closeLoadingView } from "./openLoadingView";
import { getAvailableAzureLocations } from "./utils/azureLocations";
import { getDeployPrerequisites, storeDeployPrerequisites } from "./utils/deployPrerequisites";
import { isDeploymentPlanApproved } from "./utils/deploymentPlanApprovalState";
import { buildParseError, readFileText, SingletonViewHost, watchSingleFile } from "./utils/singletonViewHost";

let selectionRevision = 0;

const host = new SingletonViewHost<DeploymentPlanData, DeploymentPlanViewController>({
    createController: (data, uri) => {
        closeLoadingView();
        return new DeploymentPlanViewController(data, uri);
    },
    updateController: (controller, data, uri) => controller.updateDeploymentPlanData(data, uri),
    onDidClose: () => { selectionRevision++; },
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

async function openDeploymentPlanViewWithContentAsync(content: string | undefined, sourceFileUri?: vscode.Uri, prerequisites?: DeploymentPrerequisite[], requireOpen = false, revision = ++selectionRevision): Promise<void> {
    const locations = await getAvailableAzureLocations();
    if (revision !== selectionRevision || (requireOpen && !host.isOpen)) {
        return;
    }

    if (content === undefined && sourceFileUri) {
        // Watch before the final read so writes during loading cannot leave stale content on screen.
        host.setWatcher(watchSingleFile(sourceFileUri, () => void reloadDeploymentPlan(sourceFileUri, requireOpen)));
        content = await readFileText(sourceFileUri);
    }

    if (sourceFileUri && !(await isSelectedDeploymentPlan(sourceFileUri))) {
        return;
    }
    if (revision !== selectionRevision || (requireOpen && !host.isOpen) || content === undefined) {
        return;
    }
    const planData = tryParseDeploymentPlan(content, sourceFileUri);

    if (prerequisites && prerequisites.length > 0) {
        planData.prerequisites = prerequisites;
    }

    // A plan the user already approved reopens read-only — no second Approve button (which
    // would re-trigger the deploy agent). Only meaningful for a cleanly-parsed plan.
    if (sourceFileUri && !planData.parseError) {
        planData.approved = isDeploymentPlanApproved(sourceFileUri, content);
    }

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
                : vscode.l10n.t('The deployment plan doesn\u2019t contain any details to show yet. This view will reload automatically when the file changes.');
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
    const revision = ++selectionRevision;
    const preparePlan = await findAppOnboardArtifact('prepare-plan.json');
    if (revision !== selectionRevision) {
        return;
    }
    if (!preparePlan) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No deployment plan found in the workspace.'));
        return;
    }
    await openDeploymentPlanViewAsync(preparePlan, false, revision);
}

async function isSelectedDeploymentPlan(uri: vscode.Uri): Promise<boolean> {
    return (await findAppOnboardArtifact('prepare-plan.json'))?.toString() === uri.toString();
}

async function openDeploymentPlanViewAsync(uri: vscode.Uri, requireOpen = false, revision = selectionRevision): Promise<void> {
    if (!(await isSelectedDeploymentPlan(uri)) || revision !== selectionRevision || (requireOpen && !host.isOpen)) {
        return;
    }
    const prerequisites = getDeployPrerequisites(uri);
    await openDeploymentPlanViewWithContentAsync(undefined, uri, prerequisites, requireOpen, ++selectionRevision);
}

async function reloadDeploymentPlan(uri: vscode.Uri, requireOpen: boolean): Promise<void> {
    try {
        await openDeploymentPlanViewAsync(uri, requireOpen);
    } catch {
        // File may have been deleted or be momentarily unavailable; ignore.
    }
}

/**
 * Records, in memory, the deploy prerequisites the `record_deploy_prerequisites` MCP tool collected for the
 * selected `prepare-plan.json`, and refreshes the plan view when it is already open so the freshly
 * detected azd/az status replaces the "unknown" fallback. Returns false when no plan exists yet.
 */
export async function recordDeployPrerequisites(prerequisites: DeploymentPrerequisite[]): Promise<boolean> {
    const preparePlan = await findAppOnboardArtifact('prepare-plan.json');
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
    let watchers: vscode.Disposable[] = [];
    const refreshActivePlan = async (): Promise<void> => {
        if (!host.isOpen) {
            return;
        }
        const revision = ++selectionRevision;
        const selected = await findAppOnboardArtifact('prepare-plan.json');
        if (revision !== selectionRevision || !host.isOpen) {
            return;
        }
        if (!selected) {
            host.close();
        } else {
            await openDeploymentPlanViewAsync(selected, true, revision);
        }
    };
    const updateWatchers = (): void => {
        for (const watcher of watchers) {
            watcher.dispose();
        }
        watchers = [];
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            for (const glob of PREPARE_PLAN_FILE_GLOBS) {
                const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, glob));
                watcher.onDidCreate(uri => void openDeploymentPlanViewAsync(uri));
                watchers.push(watcher);
            }
            const pointerWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB));
            pointerWatcher.onDidCreate(() => void refreshActivePlan());
            pointerWatcher.onDidChange(() => void refreshActivePlan());
            pointerWatcher.onDidDelete(() => void refreshActivePlan());
            watchers.push(pointerWatcher);
        }
    };
    updateWatchers();
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            updateWatchers();
            void refreshActivePlan();
        }),
        { dispose: () => { selectionRevision++; watchers.forEach(watcher => watcher.dispose()); } },
    );
}
