/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import { ArtifactValidationIssue, ArtifactValidationResult, createValidationResult } from './validationTypes';

interface PreviewManifestPage {
    slug?: unknown;
}

interface PreviewManifest {
    previewStatus?: unknown;
    pages?: unknown;
}

export async function validatePreviewArtifacts(previewDirectory: string): Promise<ArtifactValidationResult> {
    const issues: ArtifactValidationIssue[] = [];
    const manifestPath = path.join(previewDirectory, 'manifest.json');
    const manifest = await readManifest(manifestPath, issues);
    if (!manifest) {
        return createValidationResult(issues);
    }

    if (manifest.previewStatus !== 'ready') {
        issues.push({
            code: 'previewNotReady',
            path: 'manifest.previewStatus',
            message: 'Frontend preview manifest must have previewStatus "ready".',
        });
    }
    if (!Array.isArray(manifest.pages) || manifest.pages.length === 0) {
        issues.push({
            code: 'missingPreviewPages',
            path: 'manifest.pages',
            message: 'Frontend preview manifest must list at least one page.',
        });
        return createValidationResult(issues);
    }

    const slugs = new Set<string>();
    for (const [index, rawPage] of manifest.pages.entries()) {
        const page = rawPage as PreviewManifestPage;
        if (!rawPage || typeof rawPage !== 'object' || typeof page.slug !== 'string'
            || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug)) {
            issues.push({
                code: 'invalidPreviewSlug',
                path: `manifest.pages[${index}].slug`,
                message: 'Preview page slug must be a non-empty kebab-case filename stem.',
            });
            continue;
        }
        if (slugs.has(page.slug)) {
            issues.push({
                code: 'duplicatePreviewSlug',
                path: `manifest.pages[${index}].slug`,
                message: `Preview page slug "${page.slug}" is duplicated.`,
            });
            continue;
        }
        slugs.add(page.slug);
        await requireNonEmptyFile(
            path.join(previewDirectory, `${page.slug}.html`),
            `preview.${page.slug}.html`,
            'missingPreviewHtml',
            issues,
        );
    }
    await requireNonEmptyFile(
        path.join(previewDirectory, 'theme.css'),
        'preview.theme.css',
        'missingPreviewTheme',
        issues,
    );
    return createValidationResult(issues);
}

async function readManifest(
    manifestPath: string,
    issues: ArtifactValidationIssue[],
): Promise<PreviewManifest | undefined> {
    let content: string;
    try {
        content = await fs.readFile(manifestPath, 'utf8');
    } catch (error) {
        issues.push({
            code: 'missingPreviewManifest',
            path: 'preview.manifest.json',
            message: `Frontend preview manifest is missing: ${getErrorMessage(error)}`,
        });
        return undefined;
    }
    try {
        const value: unknown = JSON.parse(content);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Manifest root must be an object.');
        }
        return value as PreviewManifest;
    } catch (error) {
        issues.push({
            code: 'invalidPreviewManifest',
            path: 'preview.manifest.json',
            message: `Frontend preview manifest is invalid JSON: ${getErrorMessage(error)}`,
        });
        return undefined;
    }
}

async function requireNonEmptyFile(
    filePath: string,
    issuePath: string,
    code: string,
    issues: ArtifactValidationIssue[],
): Promise<void> {
    try {
        if ((await fs.readFile(filePath, 'utf8')).trim().length > 0) {
            return;
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
    issues.push({
        code,
        path: issuePath,
        message: `Required frontend preview file is missing or empty: ${path.basename(filePath)}.`,
    });
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
