/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in this directory for license information.
 *--------------------------------------------------------------------------------------------*/

import { getRequestListener } from '@hono/node-server';
import { isInitializeRequest, McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

export const loopbackLimits = {
    bodyBytes: 16 * 1024,
    connections: 32,
    requests: 16,
    sessions: 8,
    idleMs: 60_000,
    leaseMs: 30 * 60_000,
    shutdownMs: 1_000,
} as const;

export interface LoopbackOptions {
    id: string;
    version: string;
    registerTools: (server: McpServer, isAuthorized: () => boolean) => void;
    onError: (message: string) => void;
    onDispose?: () => void;
}

export interface LoopbackListener {
    readonly url: URL;
    readonly headers: Readonly<Record<string, string>>;
    readonly instanceId: string;
    revoke(): void;
    dispose(): Promise<void>;
}

interface Session {
    server: McpServer;
    transport: WebStandardStreamableHTTPServerTransport;
    lastUsed: number;
}

// Adapted from the maintained vscode-inproc-mcp 1.0.0 Hono listener. See README.md.
export async function startLoopbackServer(options: LoopbackOptions): Promise<LoopbackListener> {
    const credential = Buffer.from(`Nonce ${randomBytes(32).toString('base64url')}`);
    const sessions = new Map<string, Session>();
    const pending = new Set<Session>();
    const app = new Hono();
    let authority = '';
    let revoked = false;
    let requests = 0;
    let closing: Promise<void> | undefined;

    const authorized = (): boolean => !revoked;
    const failure = (status: number, message: string): Response => Response.json({
        jsonrpc: '2.0', error: { code: -32000, message }, id: null,
    }, { status });

    app.use('*', async (context, next) => {
        const origin = context.req.header('origin');
        if (context.req.header('host') !== authority || new URL(context.req.url).host !== authority
            || (origin !== undefined && origin !== `http://${authority}`)) {
            return failure(403, 'Forbidden authority or origin');
        }
        const supplied = Buffer.from(context.req.header('authorization') ?? '');
        if (revoked || supplied.length !== credential.length || !timingSafeEqual(supplied, credential)) {
            return failure(401, 'Unauthorized');
        }
        if (context.req.path !== '/mcp' || new URL(context.req.url).search) {
            return failure(404, 'Not found');
        }
        if (!['POST', 'GET', 'DELETE'].includes(context.req.method)) {
            return failure(405, 'Method not allowed');
        }
        if (requests >= loopbackLimits.requests) {
            return failure(429, 'Too many requests');
        }
        requests++;
        try {
            await next();
        } finally {
            requests--;
        }
        return undefined;
    });
    app.post('/mcp', bodyLimit({
        maxSize: loopbackLimits.bodyBytes,
        onError: () => failure(413, 'Request body too large'),
    }));
    app.all('/mcp', async (context) => {
        const request = context.req.raw;
        const sessionId = request.headers.get('mcp-session-id');
        let session = sessionId ? sessions.get(sessionId) : undefined;
        if (sessionId && !session) {
            return failure(404, 'Session terminated or unknown');
        }
        let parsedBody: unknown;
        if (request.method === 'POST') {
            try {
                parsedBody = await request.json();
            } catch {
                return failure(400, 'Invalid JSON body');
            }
        }
        if (!session) {
            if (request.method !== 'POST' || !isInitializeRequest(parsedBody)) {
                return failure(400, 'Initialization required');
            }
            if (sessions.size + pending.size >= loopbackLimits.sessions) {
                return failure(429, 'Too many sessions');
            }
            const transport = new WebStandardStreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: id => {
                    if (session) {
                        pending.delete(session);
                        sessions.set(id, session);
                    }
                },
                onsessionclosed: id => {
                    sessions.delete(id);
                },
                enableDnsRebindingProtection: true,
                allowedHosts: [authority],
                allowedOrigins: [`http://${authority}`],
            });
            const server = new McpServer({ name: options.id, version: options.version });
            session = { server, transport, lastUsed: Date.now() };
            pending.add(session);
            try {
                options.registerTools(server, authorized);
                await server.connect(transport);
            } catch {
                pending.delete(session);
                await server.close();
                options.onError('MCP session initialization failed');
                return failure(500, 'Session initialization failed');
            }
        }
        session.lastUsed = Date.now();
        try {
            return await session.transport.handleRequest(request, { parsedBody });
        } finally {
            if (pending.delete(session)) {
                await session.server.close();
            }
        }
    });
    app.onError(() => {
        options.onError('MCP HTTP request failed');
        return failure(500, 'Request failed');
    });

    const httpServer = createServer({
        maxHeaderSize: 8 * 1024,
        requestTimeout: 10_000,
        headersTimeout: 5_000,
        keepAliveTimeout: 2_000,
    }, getRequestListener(app.fetch, { overrideGlobalObjects: false }));
    httpServer.maxConnections = loopbackLimits.connections;
    httpServer.maxRequestsPerSocket = 100;
    httpServer.setTimeout(loopbackLimits.idleMs, socket => socket.destroy());
    httpServer.on('clientError', (_error, socket) => {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', () => {
            httpServer.removeListener('error', reject);
            resolve();
        });
    });
    httpServer.on('error', () => options.onError('MCP HTTP listener failed'));
    const address = httpServer.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
        httpServer.close();
        throw new Error('MCP listener did not bind IPv4 loopback');
    }
    authority = `127.0.0.1:${address.port}`;

    const idleTimer = setInterval(() => {
        for (const [id, session] of sessions) {
            if (Date.now() - session.lastUsed >= loopbackLimits.idleMs) {
                sessions.delete(id);
                void session.server.close().catch(() => options.onError('MCP idle session close failed'));
            }
        }
    }, loopbackLimits.idleMs);
    idleTimer.unref();
    const leaseTimer = setTimeout(() => {
        void dispose().catch(() => options.onError('MCP lease shutdown failed'));
    }, loopbackLimits.leaseMs);
    leaseTimer.unref();

    function revoke(): void {
        revoked = true;
        credential.fill(0);
    }

    function dispose(): Promise<void> {
        revoke();
        closing ??= (async () => {
            clearInterval(idleTimer);
            clearTimeout(leaseTimer);
            const closed = new Promise<void>((resolve, reject) => {
                httpServer.close(error => error ? reject(error) : resolve());
            });
            httpServer.closeAllConnections();
            let timer: NodeJS.Timeout | undefined;
            const deadline = new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('MCP shutdown deadline exceeded')), loopbackLimits.shutdownMs);
                timer.unref();
            });
            const sessionShutdown = Promise.all([...sessions.values(), ...pending].map(session => session.server.close()));
            sessions.clear();
            pending.clear();
            options.onDispose?.();
            try {
                await Promise.race([Promise.all([closed, sessionShutdown]), deadline]);
            } finally {
                clearTimeout(timer);
            }
        })();
        return closing;
    }

    return {
        url: new URL(`http://${authority}/mcp`),
        headers: { Authorization: credential.toString() },
        instanceId: randomUUID(),
        revoke,
        dispose,
    };
}
