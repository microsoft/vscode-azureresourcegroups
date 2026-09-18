/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getRequestListener } from '@hono/node-server';
import type { McpServer } from '@modelcontextprotocol/server';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LoopbackSessions, protocolFailure } from './loopbackSessions';

const maxBodyBytes = 16 * 1024;
const maxConnections = 32;
const maxRequests = 16;

export type RegisterTools = (server: McpServer) => void | Promise<void>;

interface LoopbackServerOptions {
    id: string;
    version: string;
    registerTools: RegisterTools;
    onError: (message: string) => void;
}

export interface LoopbackListener {
    readonly url: URL;
    readonly headers: Readonly<Record<string, string>>;
    readonly instanceId: string;
    dispose(): Promise<void>;
}

// Adapted from the maintained vscode-inproc-mcp 1.0.0 Hono listener.
export async function startLoopbackServer(options: LoopbackServerOptions): Promise<LoopbackListener> {
    const credential = Buffer.from(`Nonce ${randomBytes(32).toString('base64url')}`);
    let authorized = true;
    let authority = '';
    let requests = 0;
    let closing: Promise<void> | undefined;

    const isAuthorized = (): boolean => authorized;
    const sessions = new LoopbackSessions(options, () => authority, isAuthorized);
    const app = new Hono();

    app.use('*', async (context, next) => {
        const requestAuthority = new URL(context.req.url).host;
        const origin = context.req.header('origin');
        if (context.req.header('host') !== authority || requestAuthority !== authority
            || (origin !== undefined && origin !== `http://${authority}`)) {
            return protocolFailure(403, 'Forbidden authority or origin');
        }

        const suppliedCredential = Buffer.from(context.req.header('authorization') ?? '');
        if (!authorized || suppliedCredential.length !== credential.length
            || !timingSafeEqual(suppliedCredential, credential)) {
            return protocolFailure(401, 'Unauthorized');
        }
        if (context.req.path !== '/mcp' || new URL(context.req.url).search) {
            return protocolFailure(404, 'Not found');
        }
        if (!['POST', 'GET', 'DELETE'].includes(context.req.method)) {
            return protocolFailure(405, 'Method not allowed');
        }
        if (requests >= maxRequests) {
            return protocolFailure(429, 'Too many requests');
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
        maxSize: maxBodyBytes,
        onError: () => protocolFailure(413, 'Request body too large'),
    }));
    app.all('/mcp', context => sessions.handle(context.req.raw));
    app.onError(() => {
        options.onError('MCP HTTP request failed');
        return protocolFailure(500, 'Request failed');
    });

    const httpServer = createServer({
        maxHeaderSize: 8 * 1024,
        requestTimeout: 10_000,
        headersTimeout: 5_000,
        keepAliveTimeout: 2_000,
    }, getRequestListener(app.fetch, { overrideGlobalObjects: false }));
    httpServer.maxConnections = maxConnections;
    httpServer.maxRequestsPerSocket = 100;
    httpServer.setTimeout(60_000, socket => socket.destroy());
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

    const idleTimer = setInterval(() => sessions.closeIdle(), 60_000);
    idleTimer.unref();

    const dispose = (): Promise<void> => {
        authorized = false;
        credential.fill(0);
        closing ??= (async () => {
            clearInterval(idleTimer);
            const serverClosed = new Promise<void>((resolve, reject) => {
                httpServer.close(error => error ? reject(error) : resolve());
            });
            httpServer.closeAllConnections();
            await Promise.all([serverClosed, sessions.close()]);
        })();
        return closing;
    };

    return {
        url: new URL(`http://${authority}/mcp`),
        headers: { Authorization: credential.toString() },
        instanceId: randomUUID(),
        dispose,
    };
}
