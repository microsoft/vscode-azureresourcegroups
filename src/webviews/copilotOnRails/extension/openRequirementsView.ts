/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { parseRequirementsJson, type RequirementsData } from "../views/utils/parseRequirements";
import { RequirementsViewController } from "./controllers/RequirementsViewController";

export const REQUIREMENTS_FILE_GLOB = '**/.azure/requirements.json';

let currentController: RequirementsViewController | undefined;
let currentWatcher: vscode.Disposable | undefined;

export function isRequirementsViewOpen(): boolean {
    return currentController !== undefined;
}

export function openRequirementsView(uri: vscode.Uri): void {
    void openRequirementsViewAsync(uri);
}

export function openRequirementsViewWithContent(content: string, sourceFileUri?: vscode.Uri): void {
    const data = tryParse(content, sourceFileUri);

    if (currentController) {
        currentController.updateData(data, sourceFileUri);
        currentController.revealToForeground(vscode.ViewColumn.Active);
        return;
    }

    currentController = new RequirementsViewController(data, sourceFileUri);
    currentController.revealToForeground(vscode.ViewColumn.Active);
    currentController.panel.onDidDispose(() => {
        currentController = undefined;
        currentWatcher?.dispose();
        currentWatcher = undefined;
    });
}

function tryParse(content: string, sourceFileUri: vscode.Uri | undefined): RequirementsData {
    try {
        return parseRequirementsJson(content);
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
            questions: [],
            parseError: {
                message: errorMessage,
                fileLabel: sourceFileUri ? vscode.workspace.asRelativePath(sourceFileUri) : undefined,
            },
        };
    }
}

export async function openRequirementsViewFromWorkspace(): Promise<void> {
    const files = await vscode.workspace.findFiles(REQUIREMENTS_FILE_GLOB, '**/node_modules/**', 10);
    if (files.length === 0) {
        void vscode.window.showInformationMessage(
            vscode.l10n.t('No requirements file found. Expected `.azure/requirements.json` in the workspace.'),
        );
        return;
    }

    let selected: vscode.Uri;
    if (files.length === 1) {
        selected = files[0];
    } else {
        const picked = await vscode.window.showQuickPick(
            files.map((f) => ({ label: vscode.workspace.asRelativePath(f), uri: f })),
            { placeHolder: vscode.l10n.t('Select a requirements file to open') },
        );
        if (!picked) {
            return;
        }
        selected = picked.uri;
    }

    await openRequirementsViewAsync(selected);
}

async function openRequirementsViewAsync(uri: vscode.Uri): Promise<void> {
    const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
    openRequirementsViewWithContent(content, uri);
    watchRequirementsFile(uri);
}

function watchRequirementsFile(uri: vscode.Uri): void {
    currentWatcher?.dispose();

    const folder = vscode.Uri.file(uri.fsPath.replace(/[/\\][^/\\]+$/, ''));
    const fileName = uri.fsPath.replace(/^.*[/\\]/, '');
    const pattern = new vscode.RelativePattern(folder, fileName);

    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const reload = async () => {
        try {
            const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
            openRequirementsViewWithContent(content, uri);
        } catch {
            // File may have been deleted or be momentarily unavailable; ignore.
        }
    };
    watcher.onDidChange(() => void reload());
    watcher.onDidCreate(() => void reload());
    currentWatcher = watcher;
}

/**
 * Auto-open the requirements view whenever `.azure/requirements.json` appears
 * or changes in the workspace. Returns the disposable that owns the watcher.
 */
export function registerRequirementsAutoOpen(context: vscode.ExtensionContext): void {
    const watcher = vscode.workspace.createFileSystemWatcher(REQUIREMENTS_FILE_GLOB);
    const handle = (uri: vscode.Uri) => {
        if (isRequirementsViewOpen()) {
            // Already open — `watchRequirementsFile` handles content reload.
            return;
        }
        openRequirementsView(uri);
    };
    watcher.onDidCreate(handle);
    watcher.onDidChange(handle);
    context.subscriptions.push(watcher);
}
