/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { DEPLOY_RESULT_FILE_GLOBS } from "../../../tree/project/projectPlanFiles";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import type { DeployResultData } from "../views/utils/deployResultTypes";
import { getDeployResultRenderIssue, parseDeployResultJson } from "../views/utils/parseDeployResultJson";
import { DeployResultViewController } from "./controllers/DeployResultViewController";
import { closeLoadingView } from "./openLoadingView";
import { buildParseError, readFileText, SingletonViewHost, watchSingleFile } from "./utils/singletonViewHost";

const host = new SingletonViewHost<DeployResultData, DeployResultViewController>({
    createController: (data, uri) => {
        closeLoadingView();
        return new DeployResultViewController(data, uri);
    },
    updateController: (controller, data, uri) => controller.updateDeployResultData(data, uri),
});

export function isDeployResultViewOpen(): boolean {
    return host.isOpen;
}

export function openDeployResultView(uri: vscode.Uri): void {
    void openDeployResultViewAsync(uri);
}

export function openDeployResultViewWithContent(content: string, sourceFileUri?: vscode.Uri): void {
    host.show(tryParseDeployResult(content, sourceFileUri), sourceFileUri);
}

/**
 * Build the view model, falling back to a parse-error payload so the view can
 * explain the problem (and offer to open the file) instead of rendering blank.
 */
function tryParseDeployResult(content: string, sourceFileUri: vscode.Uri | undefined): DeployResultData {
    let parsed: DeployResultData | undefined;
    let errorMessage: string | undefined;
    try {
        parsed = parseDeployResultJson(content);
    } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
    }

    const renderIssue = parsed ? getDeployResultRenderIssue(content, parsed) : undefined;
    if (errorMessage || !parsed || renderIssue) {
        const renderIssueMessage = renderIssue === 'empty'
            ? vscode.l10n.t('The deployment result file is empty. Copilot may still be writing it. This view will reload automatically when the file changes.')
            : vscode.l10n.t('The deployment result file doesn\u2019t contain any recognizable deployment data yet. This view will reload automatically when the file changes.');

        return {
            ...(parsed ?? emptyDeployResult()),
            parseError: buildParseError(errorMessage ?? renderIssueMessage, sourceFileUri),
        };
    }
    return parsed;
}

function emptyDeployResult(): DeployResultData {
    return {
        status: 'unknown',
        healthStatus: 'unknown',
        partial: false,
        sessionId: '',
        subscriptionId: '',
        resourceGroupName: '',
        region: '',
        startedUtc: '',
        completedUtc: '',
        durationLabel: '',
        portalUrl: '',
        endpoints: [],
        resources: [],
        healingAttempts: [],
        orphanedResourceGroups: [],
        warnings: [],
        cleanupCommand: '',
    };
}

/**
 * Locate the deploy result to display. A workspace can accumulate one artifact
 * per App Onboard session, so the most recently modified file wins.
 *
 * `findFiles` is called with a `null` exclude so the dot-folders holding these
 * artifacts are not skipped by the user's `files.exclude`/`search.exclude`.
 */
async function findLatestDeployResult(): Promise<vscode.Uri | undefined> {
    const matches = (await Promise.all(
        DEPLOY_RESULT_FILE_GLOBS.map((glob) => vscode.workspace.findFiles(glob, null)),
    )).flat();

    if (matches.length === 0) {
        return undefined;
    }
    if (matches.length === 1) {
        return matches[0];
    }

    const stats = await Promise.all(matches.map(async (uri) => {
        try {
            return { uri, mtime: (await vscode.workspace.fs.stat(uri)).mtime };
        } catch {
            return { uri, mtime: 0 };
        }
    }));
    stats.sort((a, b) => b.mtime - a.mtime);
    return stats[0].uri;
}

/** Command/tool entry point: find the newest deploy result and show it. */
export async function openDeployResultViewFromWorkspace(_context: CopilotOnRailsContext): Promise<void> {
    const selected = await findLatestDeployResult();
    if (!selected) {
        void vscode.window.showInformationMessage(
            vscode.l10n.t('No deployment results found in this workspace. Deploy your project to Azure first.'),
        );
        return;
    }
    await openDeployResultViewAsync(selected);
}

async function openDeployResultViewAsync(uri: vscode.Uri): Promise<void> {
    openDeployResultViewWithContent(await readFileText(uri), uri);
    host.setWatcher(watchSingleFile(uri, () => void reloadDeployResult(uri)));
}

async function reloadDeployResult(uri: vscode.Uri): Promise<void> {
    try {
        openDeployResultViewWithContent(await readFileText(uri), uri);
    } catch {
        // File may have been deleted or be momentarily unavailable; ignore.
    }
}
