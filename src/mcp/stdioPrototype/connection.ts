/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Agent, fetch as socketFetch } from 'undici';
import type { FetchLike } from '@modelcontextprotocol/client';
import { URI } from 'vscode-uri';
import { z } from 'zod';

export const leaseEnvironmentKey = 'AZURE_RESOURCES_MCP_STDIO_LEASE';
export const maxFrameBytes = 1024 * 1024;
export const leaseSchema = z.strictObject({
    version: z.literal(1),
    instance: z.uuid(),
    serverId: z.literal('vscode-azureresourcegroups.mcp'),
    uri: z.string(),
    authorization: z.string().regex(/^Nonce [0-9a-f-]{36}$/),
    expiresAt: z.number().int().positive(),
    workspace: z.array(z.string()),
});
export type ConnectionLease = z.infer<typeof leaseSchema>;

export function createBridgeLaunchEnvironment(lease: ConnectionLease): Record<string, string> {
    const environment: Record<string, string> = { [leaseEnvironmentKey]: JSON.stringify(lease) };
    environment.ELECTRON_RUN_AS_NODE = '1';
    environment.ELECTRON_NO_ASAR = '1';
    return environment;
}

export function readLease(value: string | undefined): ConnectionLease {
    if (!value || value.length > 16 * 1024) {
        throw new Error('Missing or oversized prototype connection lease.');
    }
    // Schema errors must not include the secret or rejected input in diagnostics.
    try {
        return leaseSchema.parse(JSON.parse(value));
    } catch {
        throw new Error('Invalid prototype connection lease.');
    }
}

export async function createSocketConnection(lease: ConnectionLease): Promise<{ fetch: FetchLike; close: () => Promise<void> }> {
    if (lease.expiresAt <= Date.now()) {
        throw new Error('Prototype connection lease expired. Pair with the window again.');
    }
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
        throw new Error('Prototype stdio bridge only supports local Unix sockets. Windows pipe ACLs are not validated.');
    }
    const uri = URI.parse(lease.uri);
    if (uri.scheme !== 'unix' || uri.authority || uri.query || uri.fragment !== '/mcp' || !uri.path.startsWith('/')) {
        throw new Error('Unsupported prototype endpoint.');
    }
    const [directory, socket] = await Promise.all([lstat(dirname(uri.path)), lstat(uri.path)]);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o777) !== 0o700 ||
        directory.uid !== process.getuid?.() || !socket.isSocket() || socket.uid !== process.getuid?.()) {
        throw new Error('Prototype endpoint is not an owner-protected socket.');
    }
    const dispatcher = new Agent({
        connect: { socketPath: uri.path },
        connections: 40,
        headersTimeout: 10_000,
        bodyTimeout: 0,
    });
    return {
        fetch: async (input, init) => {
            if (String(input) !== 'http://localhost/mcp' || lease.expiresAt <= Date.now()) {
                throw new Error('Prototype endpoint or lease is no longer valid.');
            }
            const headers = new Headers(init?.headers);
            headers.set('Authorization', lease.authorization);
            if (init?.body !== undefined && init.body !== null && typeof init.body !== 'string') {
                throw new Error('Prototype HTTP adapter accepts JSON message bodies only.');
            }
            const response = await socketFetch(String(input), {
                method: init?.method,
                headers: Object.fromEntries(headers),
                body: init?.body,
                signal: init?.signal,
                dispatcher,
                redirect: 'error',
            });
            return new Response(response.body, { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers) });
        },
        close: async () => { await dispatcher.destroy(); },
    };
}
