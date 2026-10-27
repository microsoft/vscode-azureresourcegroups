/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readStringRecord(value: unknown): Record<string, string> | undefined {
    if (!isJsonObject(value) || !Object.values(value).every(entry => typeof entry === 'string')) {
        return undefined;
    }

    return value as Record<string, string>;
}
