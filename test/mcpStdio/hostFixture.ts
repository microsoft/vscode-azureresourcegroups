/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vscode-uri';

export const Uri = URI;
export class McpHttpServerDefinition {
    constructor(public label: string, public uri: URI, public headers?: Record<string, string>, public version?: string) { }
}
export const workspace = { isTrusted: true, workspaceFolders: [{ uri: URI.file('/prototype-workspace') }] };
export const env = { remoteName: undefined };
const handlers = new Map<string, (...args: unknown[]) => unknown>();
export const commands = {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(id, handler);
        return { dispose: () => { handlers.delete(id); } };
    },
    executeCommand: async (id: string, ...args: unknown[]) => {
        const handler = handlers.get(id);
        if (!handler) {
            throw new Error('Unknown fixed command.');
        }
        return await handler(...args);
    },
};
export const providers: { provideMcpServerDefinitions: () => McpHttpServerDefinition[] }[] = [];
export const lm = {
    registerMcpServerDefinitionProvider: (_id: string, provider: typeof providers[number]) => {
        providers.push(provider);
        return { dispose: () => { providers.splice(providers.indexOf(provider), 1); } };
    },
};
export const telemetryEvents: string[] = [];
export async function callWithTelemetryAndErrorHandling<T>(name: string, callback: (context: {
    errorHandling: { suppressDisplay: boolean };
    telemetry: { properties: Record<string, string> };
}) => Promise<T>): Promise<T> {
    telemetryEvents.push(name);
    return callback({ errorHandling: { suppressDisplay: false }, telemetry: { properties: {} } });
}
