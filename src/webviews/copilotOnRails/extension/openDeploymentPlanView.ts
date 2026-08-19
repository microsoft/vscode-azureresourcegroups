/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import { PREPARE_PLAN_FILE_GLOBS } from "../../../tree/project/projectPlanFiles";
import type { DeploymentPlanData } from "../views/utils/deploymentPlanTypes";
import { getPreparePlanRenderIssue, parsePreparePlanJson } from "../views/utils/parsePreparePlanJson";
import { DeploymentPlanViewController } from "./controllers/DeploymentPlanViewController";
import { closeLoadingView } from "./openLoadingView";
import { getAvailableAzureLocations } from "./utils/azureLocations";
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

export function openDeploymentPlanViewWithContent(content: string, sourceFileUri?: vscode.Uri): void {
    void openDeploymentPlanViewWithContentAsync(content, sourceFileUri);
}

async function openDeploymentPlanViewWithContentAsync(content: string, sourceFileUri?: vscode.Uri): Promise<void> {
    const planData = tryParseDeploymentPlan(content, sourceFileUri);

    const liveLocations = await getAvailableAzureLocations();
    if (liveLocations) {
        planData.availableLocations = liveLocations;
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
    // `null` disables the default `files.exclude`/`search.exclude` filtering — the plan can live in a
    // dot-folder that a user's excludes could otherwise hide.
    const matches = await Promise.all(PREPARE_PLAN_FILE_GLOBS.map(glob => vscode.workspace.findFiles(glob, null)));
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
    openDeploymentPlanViewWithContent(await readFileText(uri), uri);
    host.setWatcher(watchSingleFile(uri, () => void reloadDeploymentPlan(uri)));
}

async function reloadDeploymentPlan(uri: vscode.Uri): Promise<void> {
    try {
        openDeploymentPlanViewWithContent(await readFileText(uri), uri);
    } catch {
        // File may have been deleted or be momentarily unavailable; ignore.
    }
}
