/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { LoopbackAuthorization } from './loopbackAuthorization';
import { protocolFailure } from './loopbackResponses';
import { LoopbackSessions } from './loopbackSessions';
import { loopbackLimits, type LoopbackOptions } from './loopbackTypes';

export interface LoopbackRequestHandler {
    handleRequest: Hono['fetch'];
    sessions: LoopbackSessions;
}

export function createLoopbackRequestHandler(
    options: LoopbackOptions,
    authorization: LoopbackAuthorization,
    getAuthority: () => string,
): LoopbackRequestHandler {
    const app = new Hono();
    const sessions = new LoopbackSessions(options, getAuthority, () => authorization.isAuthorized);
    let requests = 0;

    app.use('*', async (context, next) => {
        const authority = getAuthority();
        const origin = context.req.header('origin');
        if (context.req.header('host') !== authority || new URL(context.req.url).host !== authority
            || (origin !== undefined && origin !== `http://${authority}`)) {
            return protocolFailure(403, 'Forbidden authority or origin');
        }
        if (!authorization.matches(context.req.header('authorization'))) {
            return protocolFailure(401, 'Unauthorized');
        }
        if (context.req.path !== '/mcp' || new URL(context.req.url).search) {
            return protocolFailure(404, 'Not found');
        }
        if (!['POST', 'GET', 'DELETE'].includes(context.req.method)) {
            return protocolFailure(405, 'Method not allowed');
        }
        if (requests >= loopbackLimits.requests) {
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
        maxSize: loopbackLimits.bodyBytes,
        onError: () => protocolFailure(413, 'Request body too large'),
    }));
    app.all('/mcp', context => sessions.handle(context.req.raw));
    app.onError(() => {
        options.onError('MCP HTTP request failed');
        return protocolFailure(500, 'Request failed');
    });

    return { handleRequest: app.fetch, sessions };
}
