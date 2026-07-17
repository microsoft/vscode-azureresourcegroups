/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { CopilotOnRailsContext } from "../../../utils/copilotOnRails/CopilotOnRailsContext";
import { PROJECT_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { type PlanData, parseScaffoldPlanMarkdown } from "../views/utils/parseScaffoldPlanMarkdown";
import { ScaffoldPlanViewController } from "./controllers/ScaffoldPlanViewController";
import { closeLoadingView } from "./openLoadingView";
import { handleTrackedViewClosed } from "./projectSession";
import { buildParseError, pickWorkspaceFile, readFileText, SingletonViewHost, watchSingleFile } from "./utils/singletonViewHost";

const host = new SingletonViewHost<PlanData, ScaffoldPlanViewController>({
    createController: (data, uri) => {
        closeLoadingView();
        return new ScaffoldPlanViewController(data, uri, (content) => { lastSelfWrittenPlan = content; });
    },
    updateController: (controller, data, uri) => controller.updatePlanData(data, uri),
    onDidClose: () => void handleTrackedViewClosed(),
});

/**
 * The exact plan-markdown content the controller last wrote itself (e.g. when
 * persisting a palette color pick). The file watcher compares against this to
 * skip the reload our own write would otherwise trigger — a reload re-posts plan
 * data and wipes the user's pending feedback edits.
 */
let lastSelfWrittenPlan: string | undefined;

export function isPlanViewOpen(): boolean {
    return host.isOpen;
}

export function openPlanView(uri: vscode.Uri): void {
    void openPlanViewAsync(uri);
}

export function openPlanViewWithContent(content: string, sourceFileUri?: vscode.Uri): void {
    host.show(tryParseScaffoldPlan(content, sourceFileUri), sourceFileUri);
}

/**
 * Parse the plan markdown, returning a placeholder PlanData with a parseError
 * flag if parsing fails or yields no usable content. The view uses the flag to
 * render a warning banner with an "Open file" button.
 */
function tryParseScaffoldPlan(content: string, sourceFileUri: vscode.Uri | undefined): PlanData {
    let parsed: PlanData | undefined;
    let errorMessage: string | undefined;
    try {
        parsed = parseScaffoldPlanMarkdown(content);
    } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
    }

    if (errorMessage || !parsed || parsed.sections.length === 0) {
        return {
            status: parsed?.status ?? 'Unknown',
            created: parsed?.created ?? 'Unknown',
            mode: parsed?.mode ?? 'Unknown',
            sections: parsed?.sections ?? [],
            parseError: buildParseError(
                errorMessage ?? vscode.l10n.t("The plan file couldn't be rendered as a structured view. The generated markdown didn't match the expected layout."),
                sourceFileUri,
            ),
        };
    }
    return parsed;
}

export async function openPlanViewFromWorkspace(_context: CopilotOnRailsContext): Promise<void> {
    const selected = await pickWorkspaceFile(
        PROJECT_PLAN_FILE_GLOB,
        vscode.l10n.t('No plan markdown files found in the workspace.'),
    );
    if (selected) {
        await openPlanViewAsync(selected);
    }
}

async function openPlanViewAsync(uri: vscode.Uri): Promise<void> {
    openPlanViewWithContent(await readFileText(uri), uri);
    host.setWatcher(watchSingleFile(uri, () => void reloadPlan(uri)));
}

async function reloadPlan(uri: vscode.Uri): Promise<void> {
    try {
        const text = await readFileText(uri);
        // Skip the echo of our own palette-persist write — reloading here would
        // re-post plan data and clear any pending feedback edits.
        if (text === lastSelfWrittenPlan) {
            return;
        }
        openPlanViewWithContent(text, uri);
    } catch {
        // File may have been deleted or be momentarily unavailable; ignore.
    }
}
