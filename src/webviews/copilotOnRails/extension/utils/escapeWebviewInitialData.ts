/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const INITIAL_DATA_PREFIX = `_initialData: '`;
const INITIAL_DATA_SUFFIX = `'\n`;

/**
 * encodeURIComponent leaves apostrophes unescaped. The shared webview template
 * embeds its encoded initial data in a single-quoted JavaScript literal, so
 * escape any apostrophes in that value before VS Code parses the document.
 */
export function escapeWebviewInitialData(template: string): string {
    const prefixIndex = template.indexOf(INITIAL_DATA_PREFIX);
    if (prefixIndex < 0) {
        return template;
    }

    const valueStart = prefixIndex + INITIAL_DATA_PREFIX.length;
    const valueEnd = template.indexOf(INITIAL_DATA_SUFFIX, valueStart);
    if (valueEnd < 0) {
        throw new Error('Unable to locate the end of the webview initial data.');
    }

    const escapedValue = template.slice(valueStart, valueEnd).replace(/'/g, '%27');
    return template.slice(0, valueStart) + escapedValue + template.slice(valueEnd);
}
