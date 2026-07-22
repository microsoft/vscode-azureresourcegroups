/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from "../../../extensionVariables";
import { HttpLogger } from "../HttpLogger";
import { NodeFetchNormalizer } from "./NodeFetchNormalizer";

export async function fetchWithLogging(url: string, init?: RequestInit): Promise<Response> {
    const nodeFetchLogger = new HttpLogger(ext.outputChannel, 'NodeFetch', new NodeFetchNormalizer());
    const request = createRequest(url, init);
    const response = await fetch(request, request.body ? { duplex: request.duplex } : undefined);
    nodeFetchLogger.logRequest(request);
    nodeFetchLogger.logResponse({ response, request, bodyAsText: await response.clone().text() });
    return response;
}

export function createRequest(url: string, init?: RequestInit): Request {
    return new Request(url, addDuplexToRequestInit(init));
}

function addDuplexToRequestInit(init?: RequestInit): RequestInit | undefined {
    return init?.body !== undefined && init.body !== null ? { ...init, duplex: init.duplex ?? 'half' } : init;
}
