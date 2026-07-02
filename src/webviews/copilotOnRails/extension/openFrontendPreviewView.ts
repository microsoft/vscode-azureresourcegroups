/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { FrontendPreviewViewController } from "./controllers/FrontendPreviewViewController";
import { findFrontendFolder } from "./frontendFolder";
import { closeLoadingView } from "./openLoadingView";

let controller: FrontendPreviewViewController | undefined;

/**
 * Open the frontend preview + UI-approval webview. Starts the frontend dev
 * server and renders it in an iframe behind an "Approve UI" gate.
 *
 * @param frontendFolder Optional workspace-relative path to the frontend
 *                       project. When omitted, the frontend is discovered by
 *                       locating its manifest (the folder name is product-
 *                       specific, so no fixed path is assumed).
 */
export function openFrontendPreviewView(frontendFolder?: string): void {
    void openFrontendPreviewViewAsync(frontendFolder);
}

async function openFrontendPreviewViewAsync(frontendFolder?: string): Promise<void> {
    const folder = await resolveFrontendFolder(frontendFolder);
    if (!folder) {
        return;
    }

    closeLoadingView();

    if (controller) {
        controller.revealToForeground(vscode.ViewColumn.Active);
        return;
    }

    controller = new FrontendPreviewViewController(folder);
    controller.revealToForeground(vscode.ViewColumn.Active);
    controller.panel.onDidDispose(() => {
        controller = undefined;
    });
}

export function isFrontendPreviewViewOpen(): boolean {
    return controller !== undefined;
}

/**
 * Resolve the frontend folder. An explicit caller-provided path (e.g. from the
 * scaffold agent) is honored when it contains a `package.json`; otherwise the
 * frontend is discovered by locating its manifest. Returns `undefined` (after
 * warning) when no workspace is open or no frontend project can be found.
 */
async function resolveFrontendFolder(frontendFolder: string | undefined): Promise<vscode.Uri | undefined> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) {
        void vscode.window.showWarningMessage(vscode.l10n.t('Open a workspace folder before previewing the frontend.'));
        return undefined;
    }

    const relative = frontendFolder?.trim();
    if (relative) {
        const candidate = vscode.Uri.joinPath(workspaceRoot, ...relative.split(/[\\/]+/));
        if (fs.existsSync(path.join(candidate.fsPath, 'package.json'))) {
            return candidate;
        }
        void vscode.window.showWarningMessage(
            vscode.l10n.t('No frontend project found at "{0}". Scaffold a frontend first.', relative),
        );
        return undefined;
    }

    const discovered = await findFrontendFolder();
    if (!discovered) {
        void vscode.window.showWarningMessage(
            vscode.l10n.t('No frontend project found in this workspace. Scaffold a frontend first.'),
        );
        return undefined;
    }
    return discovered;
}
