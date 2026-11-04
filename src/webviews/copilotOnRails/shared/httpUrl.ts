/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Validate a browser link, not the trustworthiness of its host or an authenticated request. */
export function getHttpUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    try {
        const url = new URL(value);
        if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password) {
            return url.href;
        }
    } catch {
        // Malformed artifact links remain displayable as text, but cannot be opened.
    }

    return undefined;
}
