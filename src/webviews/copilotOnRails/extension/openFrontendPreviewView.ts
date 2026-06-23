/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { FrontendPreviewViewController } from "./controllers/FrontendPreviewViewController";
import { closeLoadingView } from "./openLoadingView";

let controller: FrontendPreviewViewController | undefined;

/** Default location of the scaffolded frontend, relative to the workspace root. */
const DEFAULT_FRONTEND_FOLDER = 'services/web';

/**
 * Open the frontend preview + UI-approval webview. Starts the frontend dev
 * server and renders it in an iframe behind an "Approve UI" gate.
 *
 * @param frontendFolder Optional workspace-relative path to the frontend
 *                       project. Defaults to `services/web`.
 */
export function openFrontendPreviewView(frontendFolder?: string): void {
    const folder = resolveFrontendFolder(frontendFolder);
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
 * Resolve the frontend folder against the first workspace folder, validating
 * it contains a `package.json`. Returns `undefined` (after warning) when no
 * workspace is open or the folder isn't a buildable frontend project.
 */
function resolveFrontendFolder(frontendFolder: string | undefined): vscode.Uri | undefined {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) {
        void vscode.window.showWarningMessage(vscode.l10n.t('Open a workspace folder before previewing the frontend.'));
        return undefined;
    }

    const relative = frontendFolder?.trim() || DEFAULT_FRONTEND_FOLDER;
    const candidate = vscode.Uri.joinPath(workspaceRoot, ...relative.split(/[\\/]+/));
    if (!fs.existsSync(path.join(candidate.fsPath, 'package.json'))) {
        void vscode.window.showWarningMessage(
            vscode.l10n.t('No frontend project found at "{0}". Scaffold a frontend first.', relative),
        );
        return undefined;
    }
    return candidate;
}
