/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import { type PreviewPage, type PreviewStatus } from "../../views/utils/parseScaffoldPlanMarkdown";

/** Workspace-relative path of the per-page HTML preview folder written by the planner agent. */
export const PREVIEW_FOLDER_RELATIVE_PATH = path.join('.azure', '.preview-temp');

interface ManifestPage {
    slug: string;
    title?: string;
    route?: string;
    status?: 'pending' | 'ready';
}

interface Manifest {
    previewStatus?: PreviewStatus;
    pages?: ManifestPage[];
}

export interface PreviewPagesResult {
    pages: PreviewPage[];
    previewStatus?: PreviewStatus;
}

/**
 * Read the planner-generated preview folder and return one `PreviewPage` per
 * entry in `manifest.json`. The **presence of a non-empty `<slug>.html` file is
 * the source of truth** for readiness — whenever that file exists and has
 * content, the page is rendered as `ready` (with the shared `theme.css` inlined
 * into its `<head>` so the HTML is self-contained for an iframe `srcDoc`),
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
    if (!manifest?.pages?.length) {
        return { pages: [], previewStatus: manifest?.previewStatus };
    }

    const themeCss = await readOptionalText(vscode.Uri.joinPath(previewFolderUri, 'theme.css'));

    const pages: PreviewPage[] = [];
    for (const entry of manifest.pages) {
        if (!entry.slug) {
            continue;
        }
        const title = entry.title ?? entry.slug;
        const route = entry.route ?? `/${entry.slug}`;

        // File presence is the source of truth — always attempt the read, never
        // gate it on the manifest's `status`. A non-empty HTML file means the
        // page is ready even if the agent never flipped `status` to `"ready"`.
        const htmlUri = vscode.Uri.joinPath(previewFolderUri, `${entry.slug}.html`);
        const rawHtml = await readOptionalText(htmlUri);

        if (rawHtml && rawHtml.trim().length > 0) {
            pages.push({
                slug: entry.slug,
                title,
                route,
                status: 'ready',
                html: inlineThemeCss(rawHtml, themeCss),
            });
        } else {
            pages.push({ slug: entry.slug, title, route, status: 'pending' });
        }
    }
    return { pages, previewStatus: manifest.previewStatus };
}

async function readManifest(previewFolderUri: vscode.Uri): Promise<Manifest | undefined> {
    const manifestUri = vscode.Uri.joinPath(previewFolderUri, 'manifest.json');
    const text = await readOptionalText(manifestUri);
    if (!text) {
        return undefined;
    }
    try {
        return JSON.parse(text) as Manifest;
    } catch {
        return undefined;
    }
}

async function readOptionalText(uri: vscode.Uri): Promise<string | undefined> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString('utf-8');
    } catch {
        return undefined;
    }
}

/**
 * Replace every `<link rel="stylesheet" href="theme.css">` in `html` with an
 * inline `<style>` block containing `themeCss`. Keeps the iframe self-contained
 * so it works under `srcDoc` without needing `localResourceRoots` setup. If no
 * `theme.css` was read, just strips the `<link>` so the iframe doesn't 404.
 */
function inlineThemeCss(html: string, themeCss: string | undefined): string {
    const replacement = themeCss
        ? `<style data-inlined="theme.css">${themeCss}</style>`
        : '';
    // Match the common variants the agent might emit, tolerant of whitespace,
    // attribute order, single vs. double quotes, and self-closing slashes.
    const linkPattern = /<link\b[^>]*href=["']\.?\/?theme\.css["'][^>]*\/?>/gi;
    return html.replace(linkPattern, replacement);
}
