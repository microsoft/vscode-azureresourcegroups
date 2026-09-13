/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StreamableHTTPClientTransport, isJSONRPCRequest, isJSONRPCResultResponse, isJSONRPCResponse, type JSONRPCMessage } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createSocketConnection, leaseEnvironmentKey, maxFrameBytes, readLease } from './connection';
import { FrameGuard } from './frameGuard';

let startupStage = 'lease';

async function main(): Promise<void> {
    process.stderr.write('Azure Resources MCP bridge starting.\n');
    const lease = readLease(process.env[leaseEnvironmentKey]);
    delete process.env[leaseEnvironmentKey];
    startupStage = 'socket';
    const socket = await createSocketConnection(lease);
    startupStage = 'transport';
    const backend = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
        fetch: socket.fetch,
        reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    });
    const frames = new FrameGuard();
    const stdio = new StdioServerTransport(frames, process.stdout, { maxBufferSize: maxFrameBytes + 1 });
    let closing = false;
    let initializeId: string | number | undefined;
    let initialized = false;
    let discoveryProbes = 0;
    let inFlight = 0;
    const pending = new Map<string | number, NodeJS.Timeout>();
    let queuedOutputBytes = 0;
    let output = Promise.resolve();
    const shutdown = async (failed: boolean): Promise<void> => {
        if (closing) {
            return;
        }
        closing = true;
        clearTimeout(expiration);
        clearTimeout(initializationDeadline);
        for (const deadline of pending.values()) {
            clearTimeout(deadline);
        }
        pending.clear();
        process.exitCode = failed ? 1 : 0;
        if (failed) {
            process.stderr.write('Azure Resources MCP bridge disconnected. Reconnect to the selected window; do not retry an uncertain tool effect.\n');
        }
        const deadline = setTimeout(() => process.exit(process.exitCode), 2000);
        try {
            process.stdin.unpipe(frames);
            process.stdin.pause();
            await stdio.close();
            frames.destroy();
            if (backend.sessionId) {
                await backend.terminateSession();
            }
        } catch {
            process.stderr.write('Azure Resources MCP backend session cleanup failed.\n');
        } finally {
            await backend.close();
            await socket.close();
            clearTimeout(deadline);
            process.exit(process.exitCode);
        }
    };
    const expiration = setTimeout(() => { void shutdown(true); }, lease.expiresAt - Date.now());
    const initializationDeadline = setTimeout(() => { void shutdown(true); }, 10_000);
    backend.onerror = () => { void shutdown(true); };
    backend.onclose = () => { void shutdown(true); };
    stdio.onerror = () => { void shutdown(true); };
    const forwardToStdio = (message: JSONRPCMessage): void => {
        const bytes = Buffer.byteLength(JSON.stringify(message));
        queuedOutputBytes += bytes;
        if (bytes > maxFrameBytes || queuedOutputBytes > maxFrameBytes * 4) {
            void shutdown(true);
            return;
        }
        output = output.then(async () => {
            await stdio.send(message);
            queuedOutputBytes -= bytes;
        }).catch(() => shutdown(true));
    };
    backend.onmessage = (message: JSONRPCMessage) => {
        if (closing) {
            return;
        }
        if (isJSONRPCResultResponse(message) && message.id === initializeId && typeof message.result.protocolVersion === 'string') {
            const identity = message.result.serverInfo;
            if (typeof identity !== 'object' || identity === null || Array.isArray(identity) ||
                !('name' in identity) || !('version' in identity) ||
                identity.name !== lease.serverId || identity.version !== `prototype-2/${lease.instance}`) {
                void shutdown(true);
                return;
            }
            backend.setProtocolVersion(message.result.protocolVersion);
            initialized = true;
            clearTimeout(initializationDeadline);
            process.stderr.write(`Azure Resources MCP bridge initialized. instance=${lease.instance}\n`);
        }
        if (isJSONRPCResponse(message) && message.id !== undefined) {
            clearTimeout(pending.get(message.id));
            pending.delete(message.id);
        }
        forwardToStdio(message);
    };
    stdio.onmessage = (message) => {
        if (closing) {
            return;
        }
        if (isJSONRPCRequest(message) && message.method === 'server/discover' && initializeId === undefined) {
            if (++discoveryProbes > 2) {
                void shutdown(true);
                return;
            }
            process.stderr.write('Azure Resources MCP bridge declining modern discovery; backend requires initialize.\n');
            forwardToStdio({
                jsonrpc: '2.0',
                id: message.id,
                error: { code: -32601, message: 'This backend supports the MCP initialize handshake, not server/discover.' },
            });
            return;
        }
        if (isJSONRPCRequest(message) && message.method === 'initialize' && initializeId === undefined) {
            initializeId = message.id;
        } else if (!initialized) {
            void shutdown(true);
            return;
        }
        if (++inFlight > 32) {
            void shutdown(true);
            return;
        }
        if (isJSONRPCRequest(message)) {
            if (pending.has(message.id) || pending.size >= 32) {
                void shutdown(true);
                return;
            }
            pending.set(message.id, setTimeout(() => { void shutdown(true); }, 30_000));
        } else if ('method' in message && message.method === 'notifications/cancelled') {
            const requestId = message.params?.requestId;
            if (typeof requestId === 'string' || typeof requestId === 'number') {
                clearTimeout(pending.get(requestId));
                pending.delete(requestId);
            }
        }
        // Do not serialize sends: a cancellation must reach a still-running request.
        void backend.send(message, {
            onRequestStreamEnd: () => {
                if (isJSONRPCRequest(message) && pending.has(message.id)) {
                    void shutdown(true);
                }
            },
        }).catch(() => shutdown(true)).finally(() => { inFlight--; });
    };
    frames.once('end', () => { void shutdown(false); });
    frames.once('error', () => { void shutdown(true); });
    process.once('SIGTERM', () => { void shutdown(false); });
    process.once('SIGINT', () => { void shutdown(false); });
    await backend.start();
    await stdio.start();
    process.stdin.pipe(frames);
    process.stderr.write('Azure Resources MCP bridge waiting for initialization.\n');
}

void main().catch(() => {
    process.stderr.write(`Azure Resources MCP bridge could not start at ${startupStage}. Check the runtime, private lease, and owning window.\n`, () => process.exit(1));
});
