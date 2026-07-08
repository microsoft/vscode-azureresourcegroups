/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { PROJECT_PLAN_FILE_GLOB } from "../../../tree/project/projectPlanFiles";
import { parseScaffoldPlanMarkdown, type PlanData, type TreeNode } from "../views/utils/parseScaffoldPlanMarkdown";
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
 *                       project. When omitted, the frontend is discovered
 *                       automatically (see {@link resolveFrontendFolder}).
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

/** package.json dependency / tooling names that identify a web frontend project. */
const FRONTEND_MARKERS = [
    'react', 'react-dom', 'react-scripts', 'next', 'gatsby', '@remix-run/react',
    'vue', 'nuxt', '@angular/core', 'svelte', '@sveltejs/kit',
    'solid-js', 'preact', 'astro', 'vite', '@vitejs/plugin-react',
];

/** Folder-name hints that a directory holds the web frontend, most-preferred first. */
const FRONTEND_FOLDER_HINTS = ['web', 'frontend', 'client', 'ui', 'app'];

/**
 * Resolve the frontend folder against the first workspace folder. Resolution
 * order: an explicit path from the caller, then the folder named by the project
 * plan's structure tree (the source of truth — it may be product-named), then
 * the conventional `services/web`, and finally a workspace scan for a project
 * that looks like a frontend (handles a folder renamed after the plan was
 * written). Returns `undefined` (after warning) when no workspace is open or no
 * frontend project can be found.
 */
async function resolveFrontendFolder(frontendFolder: string | undefined): Promise<vscode.Uri | undefined> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) {
        void vscode.window.showWarningMessage(vscode.l10n.t('Open a workspace folder before previewing the frontend.'));
        return undefined;
    }

    // 1. An explicit path from the caller (e.g. the scaffold agent) wins.
    const explicit = frontendFolder?.trim();
    if (explicit) {
        const candidate = vscode.Uri.joinPath(workspaceRoot, ...explicit.split(/[\\/]+/));
        if (hasPackageJson(candidate)) {
            return candidate;
        }
    }

    // 2. The project plan's folder-structure tree is the source of truth.
    const fromPlan = await frontendFolderFromPlan(workspaceRoot);
    if (fromPlan) {
        return fromPlan;
    }

    // 3. The conventional scaffold location.
    const conventional = vscode.Uri.joinPath(workspaceRoot, ...DEFAULT_FRONTEND_FOLDER.split('/'));
    if (hasPackageJson(conventional)) {
        return conventional;
    }

    // 4. Fall back to scanning for a project that looks like a frontend — covers
    //    a folder renamed on disk after the plan was written.
    const discovered = await discoverFrontendFolder();
    if (discovered) {
        return discovered;
    }

    void vscode.window.showWarningMessage(
        vscode.l10n.t('No frontend project found in the workspace. Scaffold a frontend first.'),
    );
    return undefined;
}

/** A folder node collected from the project plan's structure tree. */
interface PlanFolder {
    /** Workspace-relative path segments (root excluded). */
    readonly segments: string[];
    readonly name: string;
    readonly comment?: string;
}

/** Name/comment keywords that identify a folder as the web frontend. */
const FRONTEND_PLAN_HINT = /front[\s-]?end|\breact\b|\bvue\b|svelte|angular|next\.?js|nuxt|\bvite\b|astro|gatsby|preact|solid-?js|web ?app|\bspa\b|single[\s-]?page|\bui\b/i;

/**
 * Derive the frontend folder from the project plan's folder-structure tree. The
 * plan names where the frontend lives (which may be product-named rather than
 * `services/web`), so it is the source of truth. Returns the folder only when
 * the plan names one AND it still exists on disk — a folder renamed after the
 * plan was written falls through to discovery.
 */
async function frontendFolderFromPlan(workspaceRoot: vscode.Uri): Promise<vscode.Uri | undefined> {
    const [planUri] = await vscode.workspace.findFiles(PROJECT_PLAN_FILE_GLOB, undefined, 1);
    if (!planUri) {
        return undefined;
    }

    let plan: PlanData;
    try {
        plan = parseScaffoldPlanMarkdown(Buffer.from(await vscode.workspace.fs.readFile(planUri)).toString('utf-8'));
    } catch {
        return undefined;
    }

    const frontend = collectPlanFolders(plan)
        .filter((folder) => FRONTEND_PLAN_HINT.test(`${folder.name} ${folder.comment ?? ''}`))
        .sort((a, b) => planFolderScore(b) - planFolderScore(a) || a.segments.length - b.segments.length)[0];
    if (!frontend) {
        return undefined;
    }

    const candidate = vscode.Uri.joinPath(workspaceRoot, ...frontend.segments);
    return hasPackageJson(candidate) ? candidate : undefined;
}

/** Flatten every folder node across all structure trees in the plan. */
function collectPlanFolders(plan: PlanData): PlanFolder[] {
    const folders: PlanFolder[] = [];
    const walk = (nodes: TreeNode[], prefix: string[]): void => {
        for (const node of nodes) {
            if (!node.isFolder) {
                continue;
            }
            const name = node.name.replace(/\/$/, '');
            const segments = [...prefix, name];
            folders.push({ segments, name, comment: node.comment });
            walk(node.children, segments);
        }
    };

    for (const section of plan.sections) {
        for (const content of section.content) {
            if (content.type === 'tree') {
                walk(content.nodes, []);
            }
        }
    }
    return folders;
}

/** Prefer a framework comment, then a conventional frontend folder name. */
function planFolderScore(folder: PlanFolder): number {
    let score = 0;
    if (folder.comment && FRONTEND_PLAN_HINT.test(folder.comment)) {
        score += 2;
    }
    if (['web', 'frontend', 'client', 'ui'].includes(folder.name.toLowerCase())) {
        score += 1;
    }
    return score;
}

/** True when `dir` directly contains a `package.json`. */
function hasPackageJson(dir: vscode.Uri): boolean {
    return fs.existsSync(path.join(dir.fsPath, 'package.json'));
}

/**
 * Scan the workspace for a web frontend project (a `package.json` that depends
 * on a known frontend framework/bundler), preferring folders whose name signals
 * a frontend and shallower paths. Returns the best match's directory.
 */
async function discoverFrontendFolder(): Promise<vscode.Uri | undefined> {
    const packageJsonUris = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**', 100);
    const candidates = packageJsonUris
        .map((uri) => vscode.Uri.joinPath(uri, '..'))
        .filter((dir) => looksLikeFrontend(dir));

    if (candidates.length === 0) {
        return undefined;
    }

    candidates.sort((a, b) => folderNameScore(b) - folderNameScore(a) || pathDepth(a) - pathDepth(b));
    return candidates[0];
}

/** True when the directory's `package.json` lists a known frontend dependency. */
function looksLikeFrontend(dir: vscode.Uri): boolean {
    try {
        const raw = fs.readFileSync(path.join(dir.fsPath, 'package.json'), 'utf-8');
        const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        return FRONTEND_MARKERS.some((marker) => marker in deps);
    } catch {
        return false;
    }
}

/** Higher score for folders whose name hints they hold the web frontend. */
function folderNameScore(dir: vscode.Uri): number {
    const name = path.basename(dir.fsPath).toLowerCase();
    const index = FRONTEND_FOLDER_HINTS.indexOf(name);
    return index === -1 ? 0 : FRONTEND_FOLDER_HINTS.length - index;
}

/** Number of path segments, used to prefer shallower (more likely primary) apps. */
function pathDepth(dir: vscode.Uri): number {
    return dir.fsPath.split(/[\\/]+/).length;
}
