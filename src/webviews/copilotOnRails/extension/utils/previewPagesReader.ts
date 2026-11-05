/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import { parsePreviewManifest, type PreviewManifest } from '../../shared/previewManifest';
import { type PreviewPage, type PreviewStatus } from "../../views/utils/parseScaffoldPlanMarkdown";

/** Workspace-relative path of the per-page HTML preview folder written by the planner agent. */
export const PREVIEW_FOLDER_RELATIVE_PATH = path.join('.azure', '.preview-temp');

export interface PreviewPagesResult {
    pages: PreviewPage[];
    previewStatus?: PreviewStatus;
}

/**
 * Read the planner-generated preview folder and return one `PreviewPage` per
 * entry in `manifest.json`. The **presence of a non-empty `<slug>.html` file is
 * the source of truth** for readiness — whenever that file exists and has
 * content, the page is rendered as `ready`. HTML and the shared `theme.css`
 * remain untrusted until the webview prepares and sanitizes the iframe `srcDoc`,
 * regardless of the manifest's `status` flag. The manifest `status` is only a
 * hint for the not-yet-written case: a page whose HTML file is missing or empty
 * is returned without `html`, which the webview renders as a "Generating
 * preview…" panel. This decoupling means the planner agent does NOT have to
 * remember to flip `status` to `"ready"` for the preview to appear — writing the
 * HTML file is enough.
 *
 * Returns `[]` whenever the folder or manifest is missing — the caller treats
 * that the same as "no preview available". Never throws.
 */
export async function readPreviewPages(previewFolderUri: vscode.Uri): Promise<PreviewPagesResult> {
    const manifest = await readManifest(previewFolderUri);
    if (!manifest?.pages.length) {
        return { pages: [], previewStatus: manifest?.previewStatus };
    }

    const themeCss = await readOptionalText(vscode.Uri.joinPath(previewFolderUri, 'theme.css'));

    const pages: PreviewPage[] = [];
    for (const entry of manifest.pages) {
        // File presence is the source of truth — always attempt the read, never
        // gate it on the manifest's `status`. A non-empty HTML file means the
        // page is ready even if the agent never flipped `status` to `"ready"`.
        const htmlUri = vscode.Uri.joinPath(previewFolderUri, `${entry.slug}.html`);
        const rawHtml = await readOptionalText(htmlUri);

        if (rawHtml && rawHtml.trim().length > 0) {
            pages.push({
                slug: entry.slug,
                title: entry.title,
                route: entry.route,
                status: 'ready',
                html: rawHtml,
                themeCss,
            });
        } else {
            pages.push({ slug: entry.slug, title: entry.title, route: entry.route, status: 'pending' });
        }
    }
    return { pages, previewStatus: manifest.previewStatus };
}

async function readManifest(previewFolderUri: vscode.Uri): Promise<PreviewManifest | undefined> {
    const manifestUri = vscode.Uri.joinPath(previewFolderUri, 'manifest.json');
    const text = await readOptionalText(manifestUri);
    if (!text) {
        return undefined;
    }
    return parsePreviewManifest(text);
}

async function readOptionalText(uri: vscode.Uri): Promise<string | undefined> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString('utf-8');
    } catch {
        return undefined;
    }
}
