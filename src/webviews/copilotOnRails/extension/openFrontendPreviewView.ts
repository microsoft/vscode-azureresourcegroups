/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as vscode from "vscode";
import { ext } from "../../../extensionVariables";
import { INTEGRATION_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
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

    // Priority: an explicit argument (the scaffold agent passes the real folder
    // when it opens the preview) > folders we recorded on prior opens, most
    // recent first (so resume reopens the last one) > folders named by the
    // scaffold's hand-off artifact (covers resumes where nothing was recorded,
    // e.g. a fresh window or a project scaffolded before this was tracked) >
    // the default location.
    const candidates = [
        frontendFolder?.trim(),
        ...readFrontendFolders(),
        ...await frontendFoldersFromIntegrationPlan(workspaceRoot),
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

/**
 * Frontend folders named by the scaffold's `.azure/integration-plan.md` hand-off
 * artifact. The artifact is freeform prose, so rather than parse its structure
 * we extract every workspace-relative path token and keep those that are, on
 * disk, an actual frontend project — a folder with a `package.json` AND a
 * frontend entry point. The entry-point check is what distinguishes the frontend
 * from the backend, since both have a `package.json`.
 */
async function frontendFoldersFromIntegrationPlan(workspaceRoot: vscode.Uri): Promise<string[]> {
    const [uri] = await vscode.workspace.findFiles(INTEGRATION_PLAN_FILE_GLOB, undefined, 1);
    if (!uri) {
        return [];
    }

    let text: string;
    try {
        text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
    } catch {
        return [];
    }

    // Match multi-segment relative paths (e.g. `services/web`, `apps/acme-portal`),
    // trimming any trailing slash. Single-segment tokens are ignored to avoid
    // matching prose words.
    const tokens = new Set<string>();
    for (const match of text.matchAll(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+/g)) {
        tokens.add(match[0].replace(/\/+$/, ''));
    }

    return [...tokens].filter((relative) => {
        const dir = vscode.Uri.joinPath(workspaceRoot, ...relative.split('/'));
        return hasPackageJson(dir) && isFrontendProject(dir);
    });
}

/** Frontend framework dependencies used to tell a frontend folder from a backend one. */
const FRONTEND_FRAMEWORKS = ['react', 'vue', 'svelte', '@angular/core', 'next', 'solid-js', 'preact'];

/**
 * True when `dir` looks like a frontend project: it has a root `index.html` (the
 * Vite/SPA entry point) or a frontend framework in its `package.json`.
 */
function isFrontendProject(dir: vscode.Uri): boolean {
    if (fs.existsSync(vscode.Uri.joinPath(dir, 'index.html').fsPath)) {
        return true;
    }
    try {
        const pkg = JSON.parse(fs.readFileSync(vscode.Uri.joinPath(dir, 'package.json').fsPath, 'utf-8')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        return FRONTEND_FRAMEWORKS.some((framework) => framework in deps);
    } catch {
        return false;
    }
}

/** True when `dir` directly contains a `package.json`. */
function hasPackageJson(dir: vscode.Uri): boolean {
    return fs.existsSync(vscode.Uri.joinPath(dir, 'package.json').fsPath);
}
