/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { type LocalPlanData, parseLocalPlanMarkdown } from "../views/utils/parseLocalPlanMarkdown";
import { LocalPlanViewController } from "./controllers/LocalPlanViewController";

let currentLocalPlanViewController: LocalPlanViewController | undefined;
let currentLocalPlanWatcher: vscode.Disposable | undefined;

export function isLocalPlanViewOpen(): boolean {
    return currentLocalPlanViewController !== undefined;
}

export function openLocalPlanView(uri: vscode.Uri): void {
    void openLocalPlanViewAsync(uri);
}

export function openLocalPlanViewWithContent(content: string, sourceFileUri?: vscode.Uri): void {
    const planData = tryParseLocalPlan(content, sourceFileUri);

    if (currentLocalPlanViewController) {
        currentLocalPlanViewController.updatePlanData(planData, sourceFileUri);
        currentLocalPlanViewController.revealToForeground(vscode.ViewColumn.Active);
        return;
    }

    currentLocalPlanViewController = new LocalPlanViewController(planData, sourceFileUri);
    currentLocalPlanViewController.revealToForeground(vscode.ViewColumn.Active);
    currentLocalPlanViewController.panel.onDidDispose(() => {
        currentLocalPlanViewController = undefined;
        currentLocalPlanWatcher?.dispose();
        currentLocalPlanWatcher = undefined;
    });
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
            parseError: {
                message: errorMessage ?? vscode.l10n.t("The plan file couldn't be rendered as a structured view. The generated markdown didn't match the expected layout."),
                fileLabel: sourceFileUri ? vscode.workspace.asRelativePath(sourceFileUri) : undefined,
            },
        };
    }
    return parsed;
}

export async function openLocalPlanViewFromWorkspace(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/local-development-plan.md', '**/node_modules/**', 10);
    if (files.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No local plan markdown files found in the workspace.'));
        return;
    }

    let selected: vscode.Uri;
    if (files.length === 1) {
        selected = files[0];
    } else {
        const picked = await vscode.window.showQuickPick(
            files.map((f) => ({ label: vscode.workspace.asRelativePath(f), uri: f })),
            { placeHolder: vscode.l10n.t('Select a local plan file to open') },
        );
        if (!picked) {
            return;
        }
        selected = picked.uri;
    }

    await openLocalPlanViewAsync(selected);
}

async function openLocalPlanViewAsync(uri: vscode.Uri): Promise<void> {
    const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
    openLocalPlanViewWithContent(content, uri);
    watchLocalPlanFile(uri);
}

/**
 * Watch the local plan markdown file so the webview auto-refreshes whenever
 * Copilot (or anyone else) edits it on disk.
 */
function watchLocalPlanFile(uri: vscode.Uri): void {
    currentLocalPlanWatcher?.dispose();

    const pattern = new vscode.RelativePattern(
        vscode.Uri.file(uri.fsPath.replace(/[/\\][^/\\]+$/, '')),
        uri.fsPath.replace(/^.*[/\\]/, ''),
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const reload = async () => {
        try {
            const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
            openLocalPlanViewWithContent(content, uri);
        } catch {
            // File may have been deleted or be momentarily unavailable; ignore.
        }
    };
    watcher.onDidChange(() => void reload());
    watcher.onDidCreate(() => void reload());
    currentLocalPlanWatcher = watcher;
}
