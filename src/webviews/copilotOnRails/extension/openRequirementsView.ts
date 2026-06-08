/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { parseRequirementsJson, type RequirementsData } from "../views/utils/parseRequirements";
import { RequirementsViewController } from "./controllers/RequirementsViewController";
import { buildParseError, pickWorkspaceFile, readFileText, SingletonViewHost, watchSingleFile } from "./utils/singletonViewHost";

export const REQUIREMENTS_FILE_GLOB = '**/.azure/requirements.json';

const host = new SingletonViewHost<RequirementsData, RequirementsViewController>({
    createController: (data, uri) => new RequirementsViewController(data, uri),
    updateController: (controller, data, uri) => controller.updateData(data, uri),
});

// The exact content the webview last wrote for a given file. When a watcher
// fires for that same content we know it's our own write and skip reopening the
// view we just closed. The marker is kept until the file content differs (an
// external edit), so duplicate create+change events are both suppressed.
const ownWrites = new Map<string, string>();

export function markRequirementsSubmitted(uri: vscode.Uri, serializedContent: string): void {
    ownWrites.set(uri.fsPath, serializedContent);
}

/**
 * Returns true if `content` matches the content the webview last wrote for
 * `uri` (i.e. this change was self-inflicted). When the content differs, the
 * marker is cleared so future external edits flow through normally.
 */
function isOwnWrite(uri: vscode.Uri, content: string): boolean {
    const marker = ownWrites.get(uri.fsPath);
    if (marker === undefined) {
        return false;
    }
    if (marker === content) {
        return true;
    }
    ownWrites.delete(uri.fsPath);
    return false;
}

export function isRequirementsViewOpen(): boolean {
    return host.isOpen;
}

export function openRequirementsView(uri: vscode.Uri): void {
    void openRequirementsViewAsync(uri);
}

export function openRequirementsViewWithContent(content: string, sourceFileUri?: vscode.Uri): void {
    host.show(tryParse(content, sourceFileUri), sourceFileUri);
}

function tryParse(content: string, sourceFileUri: vscode.Uri | undefined): RequirementsData {
    try {
        return parseRequirementsJson(content);
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
            questions: [],
            parseError: buildParseError(errorMessage, sourceFileUri),
        };
    }
}

export async function openRequirementsViewFromWorkspace(): Promise<void> {
    const selected = await pickWorkspaceFile(
        REQUIREMENTS_FILE_GLOB,
        vscode.l10n.t('No requirements file found. Expected `.azure/requirements.json` in the workspace.'),
        vscode.l10n.t('Select a requirements file to open'),
    );
    if (selected) {
        await openRequirementsViewAsync(selected);
    }
}

async function openRequirementsViewAsync(uri: vscode.Uri): Promise<void> {
    openRequirementsViewWithContent(await readFileText(uri), uri);
    host.setWatcher(watchSingleFile(uri, () => void reloadRequirements(uri)));
}

async function reloadRequirements(uri: vscode.Uri): Promise<void> {
    let content: string;
    try {
        content = await readFileText(uri);
    } catch {
        // File may have been deleted or be momentarily unavailable; ignore.
        return;
    }
    if (isOwnWrite(uri, content)) {
        return;
    }
    openRequirementsViewWithContent(content, uri);
}

/**
 * Auto-open the requirements view whenever `.azure/requirements.json` appears
 * or changes in the workspace.
 */
export function registerRequirementsAutoOpen(context: vscode.ExtensionContext): void {
    const watcher = vscode.workspace.createFileSystemWatcher(REQUIREMENTS_FILE_GLOB);
    const handle = async (uri: vscode.Uri) => {
        if (isRequirementsViewOpen()) {
            // Already open — the per-file watcher handles content reload.
            return;
        }
        let content: string;
        try {
            content = await readFileText(uri);
        } catch {
            return;
        }
        if (isOwnWrite(uri, content)) {
            // The user just submitted this file; don't reopen the view we just closed.
            return;
        }
        openRequirementsView(uri);
    };
    watcher.onDidCreate((uri) => void handle(uri));
    watcher.onDidChange((uri) => void handle(uri));
    context.subscriptions.push(watcher);
}
