/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

export interface BuiltinResolver {
    readonly resolverKind: 'builtin';
}

export function isBuiltinResolver(x: unknown): x is BuiltinResolver {
    if (typeof (x) === 'object') {
        return (x as BuiltinResolver).resolverKind === 'builtin';
    }

    return false;
}
