import { ext } from "../../../extensionVariables";
import { HttpLogger } from "../HttpLogger";
import { NodeFetchNormalizer } from "./NodeFetchNormalizer";

export async function fetchWithLogging(url: RequestInfo, init?: RequestInit): Promise<Response> {
    const nodeFetchLogger = new HttpLogger(ext.outputChannel, 'NodeFetch', new NodeFetchNormalizer());
    const request = new Request(url, init);
    const response = await fetch(request);
    nodeFetchLogger.logRequest(request);
    nodeFetchLogger.logResponse({ response, request, bodyAsText: await response.clone().text() });
    return response;
}
