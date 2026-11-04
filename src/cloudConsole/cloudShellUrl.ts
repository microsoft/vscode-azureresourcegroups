/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Keep this module independent of VS Code: the terminal launcher runs in a child process.
export function requireSecureCloudShellUrl(value: unknown, protocol: 'https:' | 'wss:'): string {
    const invalidEndpoint = (): Error => new Error('Cloud Shell returned an invalid or insecure endpoint URL.');

    if (typeof value !== 'string') {
        throw invalidEndpoint();
    }

    let url: URL;

    try {
        url = new URL(value);
    } catch {
        throw invalidEndpoint();
    }

    if (url.protocol !== protocol || !url.hostname || url.username || url.password || url.hash) {
        throw invalidEndpoint();
    }

    // Hosts come from the configured cloud's service responses, not a public-cloud suffix list.
    return url.href;
}
