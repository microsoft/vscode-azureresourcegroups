/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import { type PreviewPage } from "../../views/utils/parseScaffoldPlanMarkdown";

/** Workspace-relative path of the per-page HTML preview folder written by the planner agent. */
export const PREVIEW_FOLDER_RELATIVE_PATH = path.join('.azure', '.preview-temp');

interface ManifestPage {
    slug: string;
    title?: string;
    route?: string;
    status?: 'pending' | 'ready';
}

interface Manifest {
    pages?: ManifestPage[];
}

/**
 * Read the planner-generated preview folder and return one `PreviewPage` per
 * entry in `manifest.json`. For pages whose HTML file exists on disk, the
 * shared `theme.css` is inlined into the `<head>` so each page's HTML is fully
 * self-contained and safe to drop into an iframe `srcDoc`. Pages whose HTML
 * file is missing (or whose manifest entry is still `pending`) are returned
 * without `html`, which the webview renders as a "Generating preview…" panel.
 *
 * Returns `[]` whenever the folder or manifest is missing — the caller treats
 * that the same as "no preview available". Never throws.
 */
export async function readPreviewPages(previewFolderUri: vscode.Uri): Promise<PreviewPage[]> {
    const manifest = await readManifest(previewFolderUri);
    if (!manifest?.pages?.length) {
        return [];
    }

    const themeCss = await readOptionalText(vscode.Uri.joinPath(previewFolderUri, 'theme.css'));

    const pages: PreviewPage[] = [];
    for (const entry of manifest.pages) {
        if (!entry.slug) {
            continue;
        }
        const title = entry.title ?? entry.slug;
        const route = entry.route ?? `/${entry.slug}`;
        const declaredStatus: 'pending' | 'ready' = entry.status === 'ready' ? 'ready' : 'pending';

        const htmlUri = vscode.Uri.joinPath(previewFolderUri, `${entry.slug}.html`);
        const rawHtml = declaredStatus === 'ready' ? await readOptionalText(htmlUri) : undefined;

        if (rawHtml && rawHtml.length > 0) {
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
    return pages;
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
