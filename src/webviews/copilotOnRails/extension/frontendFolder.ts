/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";

/**
 * Dependency names that identify a `package.json` as a web frontend. The plan
 * always scaffolds the frontend with one of the supported frameworks (or Vite),
 * so the presence of any of these in `dependencies`/`devDependencies` reliably
 * distinguishes the frontend manifest from a backend or shared-package one.
 */
const FRONTEND_DEPENDENCY_MARKERS = [
    'react',
    'react-dom',
    'vue',
    '@angular/core',
    'svelte',
    'next',
    'vite',
];

/**
 * Locate the scaffolded frontend project by finding its manifest, rather than
 * assuming a fixed path. The frontend folder is product-named (e.g.
 * `services/<project>-portal`), so the only reliable signal is a `package.json`
 * that depends on a frontend framework. Returns the folder URI, or `undefined`
 * when no frontend manifest is present in the workspace.
 */
export async function findFrontendFolder(): Promise<vscode.Uri | undefined> {
    const manifests = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
    for (const manifest of manifests) {
        if (await isFrontendManifest(manifest)) {
            return vscode.Uri.file(path.dirname(manifest.fsPath));
        }
    }
    return undefined;
}

/** True when the given `package.json` declares a frontend-framework dependency. */
async function isFrontendManifest(uri: vscode.Uri): Promise<boolean> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
        const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        return FRONTEND_DEPENDENCY_MARKERS.some((marker) => marker in deps);
    } catch {
        // Unreadable or non-JSON manifest — treat as "not a frontend".
        return false;
    }
}
