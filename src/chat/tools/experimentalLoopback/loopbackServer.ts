/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getRequestListener } from '@hono/node-server';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { LoopbackAuthorization } from './loopbackAuthorization';
import { createLoopbackRequestHandler } from './loopbackRequestHandler';
import { loopbackLimits, type LoopbackListener, type LoopbackOptions } from './loopbackTypes';

export { loopbackLimits, type LoopbackListener, type LoopbackOptions } from './loopbackTypes';

// Adapted from the maintained vscode-inproc-mcp 1.0.0 Hono listener.
export async function startLoopbackServer(options: LoopbackOptions): Promise<LoopbackListener> {
    const authorization = new LoopbackAuthorization();
    let authority = '';
    let closing: Promise<void> | undefined;
    const requestHandler = createLoopbackRequestHandler(options, authorization, () => authority);

    const httpServer = createServer({
        maxHeaderSize: 8 * 1024,
        requestTimeout: 10_000,
        headersTimeout: 5_000,
        keepAliveTimeout: 2_000,
    }, getRequestListener(requestHandler.handleRequest, { overrideGlobalObjects: false }));
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
        requestHandler.sessions.closeIdle();
    }, loopbackLimits.idleMs);
    idleTimer.unref();
    const leaseTimer = setTimeout(() => {
        void dispose().catch(() => options.onError('MCP lease shutdown failed'));
    }, loopbackLimits.leaseMs);
    leaseTimer.unref();

    function revoke(): void {
        authorization.revoke();
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
            const sessionShutdown = requestHandler.sessions.close();
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
        headers: { Authorization: authorization.header },
        instanceId: randomUUID(),
        revoke,
        dispose,
    };
}
