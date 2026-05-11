/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { parseLocalPlanMarkdown } from "../views/utils/parseLocalPlanMarkdown";
import { LocalPlanViewController } from "./controllers/LocalPlanViewController";

let currentLocalPlanViewController: LocalPlanViewController | undefined;

export function isLocalPlanViewOpen(): boolean {
    return currentLocalPlanViewController !== undefined;
}

export function openLocalPlanView(uri: vscode.Uri): void {
    void openLocalPlanViewAsync(uri);
}

export function openLocalPlanViewWithContent(content: string): void {
    const planData = parseLocalPlanMarkdown(content);

    if (currentLocalPlanViewController) {
        currentLocalPlanViewController.updatePlanData(planData);
        currentLocalPlanViewController.revealToForeground(vscode.ViewColumn.Active);
        return;
    }

    currentLocalPlanViewController = new LocalPlanViewController(planData);
    currentLocalPlanViewController.revealToForeground(vscode.ViewColumn.Active);
    currentLocalPlanViewController.panel.onDidDispose(() => {
        currentLocalPlanViewController = undefined;
    });
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
    openLocalPlanViewWithContent(content);
}
