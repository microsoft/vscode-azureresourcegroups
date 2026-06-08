/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { type LocalPlanData, parseLocalPlanMarkdown } from "../views/utils/parseLocalPlanMarkdown";
import { LocalPlanViewController } from "./controllers/LocalPlanViewController";
import { buildParseError, pickWorkspaceFile, readFileText, SingletonViewHost, watchSingleFile } from "./utils/singletonViewHost";

const host = new SingletonViewHost<LocalPlanData, LocalPlanViewController>({
    createController: (data, uri) => new LocalPlanViewController(data, uri),
    updateController: (controller, data, uri) => controller.updatePlanData(data, uri),
});

export function isLocalPlanViewOpen(): boolean {
    return host.isOpen;
}

export function openLocalPlanView(uri: vscode.Uri): void {
    void openLocalPlanViewAsync(uri);
}

export function openLocalPlanViewWithContent(content: string, sourceFileUri?: vscode.Uri): void {
    host.show(tryParseLocalPlan(content, sourceFileUri), sourceFileUri);
}

function tryParseLocalPlan(content: string, sourceFileUri: vscode.Uri | undefined): LocalPlanData {
    let parsed: LocalPlanData | undefined;
    let errorMessage: string | undefined;
    try {
        parsed = parseLocalPlanMarkdown(content);
    } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
    }

    if (errorMessage || !parsed || parsed.sections.length === 0) {
        return {
            title: parsed?.title ?? 'Local Development Plan',
            status: parsed?.status ?? 'Unknown',
            headerNote: parsed?.headerNote ?? '',
            sections: parsed?.sections ?? [],
            parseError: buildParseError(
                errorMessage ?? vscode.l10n.t("The plan file couldn't be rendered as a structured view. The generated markdown didn't match the expected layout."),
                sourceFileUri,
            ),
        };
    }
    return parsed;
}

export async function openLocalPlanViewFromWorkspace(): Promise<void> {
    const selected = await pickWorkspaceFile(
        '**/vscode-debug-plan.md',
        vscode.l10n.t('No local plan markdown files found in the workspace.'),
        vscode.l10n.t('Select a local plan file to open'),
    );
    if (selected) {
        await openLocalPlanViewAsync(selected);
    }
}

async function openLocalPlanViewAsync(uri: vscode.Uri): Promise<void> {
    openLocalPlanViewWithContent(await readFileText(uri), uri);
    host.setWatcher(watchSingleFile(uri, () => void reloadLocalPlan(uri)));
}

async function reloadLocalPlan(uri: vscode.Uri): Promise<void> {
    try {
        openLocalPlanViewWithContent(await readFileText(uri), uri);
    } catch {
        // File may have been deleted or be momentarily unavailable; ignore.
    }
}
