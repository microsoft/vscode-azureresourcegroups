/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isJsonObject } from './jsonUtils';

export interface PreviewManifestPage {
    slug: string;
    title: string;
    route: string;
    status: 'pending' | 'ready';
}

export interface PreviewManifest {
    previewStatus?: 'generating' | 'ready';
    pages: PreviewManifestPage[];
}

const previewPageSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parsePreviewManifest(text: string): PreviewManifest | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return undefined;
    }

    if (!isJsonObject(parsed)) {
        return undefined;
    }

    return {
        previewStatus: parsed.previewStatus === 'generating' || parsed.previewStatus === 'ready'
            ? parsed.previewStatus
            : undefined,
        pages: Array.isArray(parsed.pages)
            ? parsed.pages.filter(isPreviewManifestPage)
            : [],
    };
}

function isPreviewManifestPage(value: unknown): value is PreviewManifestPage {
    return isJsonObject(value)
        && typeof value.slug === 'string'
        && previewPageSlugPattern.test(value.slug)
        && typeof value.title === 'string'
        && value.title.trim().length > 0
        && typeof value.route === 'string'
        && value.route.trim().length > 0
        && (value.status === 'pending' || value.status === 'ready');
}
