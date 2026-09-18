/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function protocolFailure(status: number, message: string): Response {
    return Response.json({
        jsonrpc: '2.0',
        error: { code: -32000, message },
        id: null,
    }, { status });
}
