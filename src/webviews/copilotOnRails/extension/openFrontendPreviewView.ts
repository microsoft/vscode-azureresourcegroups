/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as vscode from "vscode";
import { ext } from "../../../extensionVariables";
import { FrontendPreviewViewController } from "./controllers/FrontendPreviewViewController";
import { closeLoadingView } from "./openLoadingView";

let controller: FrontendPreviewViewController | undefined;

/** Default location of the scaffolded frontend, relative to the workspace root. */
const DEFAULT_FRONTEND_FOLDER = 'services/web';

/**
 * Workspace-memento key holding the frontend folders we've successfully opened
 * the preview for, most-recently-opened first.
 */
const FRONTEND_FOLDERS_KEY = 'azureResourceGroups.copilotOnRails.frontendFolders';

/**
 * Open the frontend preview + UI-approval webview. Starts the frontend dev
 * server and renders it in an iframe behind an "Approve UI" gate.
 *
 * @param frontendFolder Optional workspace-relative path to the frontend
 *                       project. When omitted, the most recently recorded folder
 *                       (see {@link FRONTEND_FOLDERS_KEY}) is used, falling back
 *                       to {@link DEFAULT_FRONTEND_FOLDER}.
 */
export async function openFrontendPreviewView(frontendFolder?: string): Promise<void> {
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

async function resolveFrontendFolder(frontendFolder: string | undefined): Promise<vscode.Uri | undefined> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) {
        return undefined;
    }

    const candidates = [
        frontendFolder?.trim(),
        ...readFrontendFolders(),
        DEFAULT_FRONTEND_FOLDER,
    ];

    for (const relative of candidates) {
        if (!relative) {
            continue;
        }
        const candidate = vscode.Uri.joinPath(workspaceRoot, ...relative.split(/[\\/]+/));
        if (hasPackageJson(candidate)) {
            // Record the folder that actually resolved so a later resume (which
            // reopens the preview with no argument) finds it directly.
            await rememberFrontendFolder(relative);
            return candidate;
        }
    }

    return undefined;
}

/** The recorded frontend folders, most-recently-opened first. */
function readFrontendFolders(): string[] {
    return ext.context.workspaceState.get<string[]>(FRONTEND_FOLDERS_KEY) ?? [];
}

/** Records `relative` as the most-recently-opened frontend, de-duplicated. */
async function rememberFrontendFolder(relative: string): Promise<void> {
    const others = readFrontendFolders().filter((folder) => folder !== relative);
    await ext.context.workspaceState.update(FRONTEND_FOLDERS_KEY, [relative, ...others]);
}

/** True when `dir` directly contains a `package.json`. */
function hasPackageJson(dir: vscode.Uri): boolean {
    return fs.existsSync(vscode.Uri.joinPath(dir, 'package.json').fsPath);
}
