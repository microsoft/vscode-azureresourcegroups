/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, createProjectPlanFileWatcher, DEPLOY_RESULT_FILE_GLOBS, findProjectFiles } from "../../../tree/project/projectPlanFiles";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import type { DeployResultData } from "../views/utils/deployResultTypes";
import { getDeployResultRenderIssue, parseDeployResultJson } from "../views/utils/parseDeployResultJson";
import { DeployResultViewController } from "./controllers/DeployResultViewController";
import { ensureDeployInventoryCaptured } from "./deployInventoryWatcher";
import { disarmDeployProgressWatcher } from "./deployProgressWatcher";
import { closeLoadingView } from "./openLoadingView";
import { parseDeployResultStatus } from "./utils/deployProgressSteps";
import { buildParseError, readFileText, SingletonViewHost, watchSingleFile } from "./utils/singletonViewHost";

const host = new SingletonViewHost<DeployResultData, DeployResultViewController>({
    createController: (data, uri) => new DeployResultViewController(data, uri),
    updateController: (controller, data, uri) => controller.updateDeployResultData(data, uri),
});

export function isDeployResultViewOpen(): boolean {
    return host.isOpen;
}

export function openDeployResultView(uri: vscode.Uri): void {
    void openDeployResultViewAsync(uri);
}

export function openDeployResultViewWithContent(content: string, sourceFileUri?: vscode.Uri): void {
    disarmDeployProgressWatcher();
    closeLoadingView();
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
        resourcesToCleanup: [],
        resourcesToReview: [],
    };
}

/**
 * Locate the deploy result to display. The deploy agent writes one artifact per
 * App Onboard session, either at the `.azure/` root or under
 * `.copilot-azure/sessions/{sessionId}/`, so a workspace can accumulate several.
 * The session that `active-session.json` points at wins; if that pointer is
 * missing or stale, the most recently modified file does.
 *
 * Resolved against the file system rather than the search index: the deploy agent git-ignores
 * `.copilot-azure/`, and `vscode.workspace.findFiles` skips git-ignored files by default.
 */
async function findLatestDeployResult(): Promise<vscode.Uri | undefined> {
    const matches = (await Promise.all(
        DEPLOY_RESULT_FILE_GLOBS.map((glob) => findProjectFiles(glob)),
    )).flat();

    if (matches.length === 0) {
        return undefined;
    }
    if (matches.length === 1) {
        return matches[0];
    }

    const active = await findActiveSessionDeployResult(matches);
    if (active) {
        return active;
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

/**
 * Resolve the deploy result belonging to the session `active-session.json`
 * points at. Returns undefined when there is no pointer, it can't be read, or
 * the session it names has no result file yet.
 */
async function findActiveSessionDeployResult(matches: readonly vscode.Uri[]): Promise<vscode.Uri | undefined> {
    const pointers = await vscode.workspace.findFiles(APP_ONBOARD_ACTIVE_SESSION_FILE_GLOB, null);

    for (const pointer of pointers) {
        let activeSessionId: string | undefined;
        try {
            const parsed = JSON.parse(await readFileText(pointer)) as { activeSessionId?: unknown };
            activeSessionId = typeof parsed?.activeSessionId === 'string' ? parsed.activeSessionId : undefined;
        } catch {
            continue;
        }
        if (!activeSessionId) {
            continue;
        }

        // The pointer lives at `.copilot-azure/sessions/active-session.json`, so
        // the session it names is a sibling folder.
        const expected = vscode.Uri.joinPath(pointer, '..', activeSessionId, 'deploy-result.json').path;
        const match = matches.find((uri) => uri.path === expected);
        if (match) {
            return match;
        }
    }

    return undefined;
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
    // Render immediately with whatever the artifact currently holds, then compute the deterministic
    // inventory in the background. When it writes createdResources[] back, the single-file watcher
    // reloads the view — so the safety net's (possibly multi-second) Azure call never blocks the
    // first paint, even if the agent never called capture_deployment_inventory.
    openDeployResultViewWithContent(await readFileText(uri), uri);
    surfacedDeployResults.add(uri.toString());

    host.setWatcher(watchSingleFile(uri, () => void reloadDeployResult(uri)));
    void ensureDeployInventoryCaptured(uri);
}

async function reloadDeployResult(uri: vscode.Uri): Promise<void> {
    try {
        openDeployResultViewWithContent(await readFileText(uri), uri);
    } catch {
        // File may have been deleted or be momentarily unavailable; ignore.
    }
}

/**
 * Files this window has already surfaced the results view for, so a view the user deliberately
 * closed is never forced back open by a later write to the same artifact (the inventory safety net
 * in {@link ensureDeployInventoryCaptured} writes to it after the deploy finishes).
 */
const surfacedDeployResults = new Set<string>();

/**
 * Forget which artifacts have been surfaced, so the next deployment gets its own auto-open.
 *
 * Deploy results are not always written to a fresh path — a repeat deployment can overwrite
 * `.azure/deploy-result.json` in place — so without this reset the first deployment in a window
 * would permanently suppress the safety net for every later one.
 */
export function resetSurfacedDeployResults(): void {
    surfacedDeployResults.clear();
}

/**
 * Auto-open the Deployment Results view once `deploy-result.json` reaches a terminal status.
 *
 * The deploy agent is required to call `open_deploy_result_view` when the deploy phase ends, but an
 * LLM tool call is never a hard guarantee — and the deployment progress view shown since plan
 * approval only stands down when this view takes over. Without this net a skipped tool call would
 * leave the user watching a spinner for a deployment that already finished.
 *
 * Only terminal writes open the view: the artifact is first created with `status: "in-progress"`,
 * which must not pop a half-empty results view mid-deploy.
 */
export function registerDeployResultAutoOpen(context: vscode.ExtensionContext): void {
    const handle = async (uri: vscode.Uri): Promise<void> => {
        if (surfacedDeployResults.has(uri.toString())) {
            return;
        }
        let status: string | undefined;
        try {
            status = parseDeployResultStatus(await readFileText(uri));
        } catch {
            // Momentary partial write; a later change event re-triggers this check.
            return;
        }
        if (status !== 'succeeded' && status !== 'failed') {
            return;
        }
        await openDeployResultViewAsync(uri);
    };

    for (const glob of DEPLOY_RESULT_FILE_GLOBS) {
        const watcher = createProjectPlanFileWatcher(glob);
        watcher.onDidCreate((uri) => void handle(uri));
        watcher.onDidChange((uri) => void handle(uri));
        context.subscriptions.push(watcher);
    }
}
