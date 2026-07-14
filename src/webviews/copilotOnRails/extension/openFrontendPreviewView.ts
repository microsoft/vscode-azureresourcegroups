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
 *                       project. When omitted, the frontend folder is derived
 *                       from the project plan (see {@link resolveFrontendFolder}).
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

/** Folder names (from the project plan's structure tree) that identify the web frontend. */
const FRONTEND_FOLDER_NAMES = ['web', 'frontend', 'client', 'ui', 'app'];

async function resolveFrontendFolder(frontendFolder: string | undefined): Promise<vscode.Uri | undefined> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) {
        return undefined;
    }

    const candidates = [
        frontendFolder?.trim(),
        await frontendFolderFromPlan(),
        DEFAULT_FRONTEND_FOLDER,
    ];

    for (const relative of candidates) {
        if (!relative) {
            continue;
        }
        const candidate = vscode.Uri.joinPath(workspaceRoot, ...relative.split(/[\\/]+/));
        if (hasPackageJson(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

/** A folder node collected from the project plan's structure tree. */
interface PlanFolder {
    /** Workspace-relative path segments (root excluded). */
    readonly segments: string[];
    readonly name: string;
}

/**
 * Derive the frontend folder from the project plan's folder-structure tree.
 */
async function frontendFolderFromPlan(): Promise<string | undefined> {
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
        .find((folder) => FRONTEND_FOLDER_NAMES.includes(folder.name.toLowerCase()));
    return frontend?.segments.join('/');
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
            folders.push({ segments, name });
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

/** True when `dir` directly contains a `package.json`. */
function hasPackageJson(dir: vscode.Uri): boolean {
    return fs.existsSync(path.join(dir.fsPath, 'package.json'));
}
