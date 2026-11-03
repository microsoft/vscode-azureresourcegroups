/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Validate a browser link, not the trustworthiness of its host or an authenticated request. */
export function getHttpUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const text = value.trim();
    if (!/^https?:\/\//i.test(text) || /[\p{Cc}\s\\]/u.test(text)) {
        return undefined;
    }

    try {
        const url = new URL(text);
        if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password) {
            return text;
        }
    } catch {
        // Malformed artifact links remain displayable as text, but cannot be opened.
    }
    return undefined;
}
