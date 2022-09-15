/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function isArray<T>(maybeArray: T[] | null | undefined): maybeArray is T[] {
    return Array.isArray(maybeArray);
}
