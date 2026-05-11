/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { parseScaffoldPlanMarkdown } from "../views/utils/parseScaffoldPlanMarkdown";
import { ScaffoldPlanViewController } from "./controllers/ScaffoldPlanViewController";

let currentPlanViewController: ScaffoldPlanViewController | undefined;
let currentPlanWatcher: vscode.Disposable | undefined;

export function isPlanViewOpen(): boolean {
    return currentPlanViewController !== undefined;
}

export function openPlanView(uri: vscode.Uri): void {
    void openPlanViewAsync(uri);
}

export function openPlanViewWithContent(content: string): void {
    const planData = parseScaffoldPlanMarkdown(content);

    if (currentPlanViewController) {
        currentPlanViewController.updatePlanData(planData);
        currentPlanViewController.revealToForeground(vscode.ViewColumn.Active);
        return;
    }

    currentPlanViewController = new ScaffoldPlanViewController(planData);
    currentPlanViewController.revealToForeground(vscode.ViewColumn.Active);
    currentPlanViewController.panel.onDidDispose(() => {
        currentPlanViewController = undefined;
        currentPlanWatcher?.dispose();
        currentPlanWatcher = undefined;
    });
}

export async function openPlanViewFromWorkspace(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/project-plan.md', '**/node_modules/**', 10);
    if (files.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No plan markdown files found in the workspace.'));
        return;
    }

    let selected: vscode.Uri;
    if (files.length === 1) {
        selected = files[0];
    } else {
        const picked = await vscode.window.showQuickPick(
            files.map((f) => ({ label: vscode.workspace.asRelativePath(f), uri: f })),
            { placeHolder: vscode.l10n.t('Select a plan file to open') },
        );
        if (!picked) {
            return;
        }
        selected = picked.uri;
    }

    await openPlanViewAsync(selected);
}

async function openPlanViewAsync(uri: vscode.Uri): Promise<void> {
    const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
    openPlanViewWithContent(content);
    watchPlanFile(uri);
}

/**
 * Watch the plan markdown file for changes (e.g. Copilot finishes revising it)
 * and push the updated content to the webview so the user doesn't get stuck on
 * a stale view. Re-watching the same URI is a no-op; switching files disposes
 * the previous watcher.
 */
function watchPlanFile(uri: vscode.Uri): void {
    currentPlanWatcher?.dispose();

    const pattern = new vscode.RelativePattern(
        vscode.Uri.file(uri.fsPath.replace(/[/\\][^/\\]+$/, '')),
        uri.fsPath.replace(/^.*[/\\]/, ''),
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const reload = async () => {
        try {
            const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
            openPlanViewWithContent(content);
        } catch {
            // File may have been deleted or be momentarily unavailable; ignore.
        }
    };
    watcher.onDidChange(() => void reload());
    watcher.onDidCreate(() => void reload());
    currentPlanWatcher = watcher;
}
