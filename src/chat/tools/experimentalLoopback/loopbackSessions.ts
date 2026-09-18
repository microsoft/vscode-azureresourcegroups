/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isInitializeRequest, McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { randomUUID } from 'node:crypto';
import type { RegisterTools } from './loopbackServer';

const idleMs = 60_000;

interface SessionOptions {
    id: string;
    version: string;
    registerTools: RegisterTools;
    onError: (message: string) => void;
}

class Session {
    public readonly server: McpServer;
    public readonly transport: WebStandardStreamableHTTPServerTransport;
    public lastUsed = Date.now();

    public constructor(
        options: SessionOptions,
        authority: string,
        onInitialized: (id: string, session: Session) => void,
        onClosed: (id: string) => void,
    ) {
        this.server = new McpServer({ name: options.id, version: options.version });
        this.transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: sessionId => onInitialized(sessionId, this),
            onsessionclosed: onClosed,
            enableDnsRebindingProtection: true,
            allowedHosts: [authority],
            allowedOrigins: [`http://${authority}`],
        });
    }
}

export class LoopbackSessions {
    // F5 has one Agent Host client, so a fresh initialize replaces its stale session.
    private active: { id: string; session: Session } | undefined;
    private pending: Session | undefined;

    public constructor(
        private readonly options: SessionOptions,
        private readonly getAuthority: () => string,
        private readonly isAuthorized: () => boolean,
    ) { }

    public async handle(request: Request): Promise<Response> {
        const sessionId = request.headers.get('mcp-session-id');
        let session = sessionId === this.active?.id ? this.active.session : undefined;
        if (sessionId && !session) {
            return protocolFailure(404, 'Session terminated or unknown');
        }

        let body: unknown;
        if (request.method === 'POST') {
            try {
                body = await request.json();
            } catch {
                return protocolFailure(400, 'Invalid JSON body');
            }
        }

        if (!this.isAuthorized()) {
            return protocolFailure(401, 'Unauthorized');
        }
        if (!session) {
            if (request.method !== 'POST' || !isInitializeRequest(body)) {
                return protocolFailure(400, 'Initialization required');
            }
            if (this.pending) {
                return protocolFailure(409, 'Initialization already in progress');
            }
            session = await this.replaceSession();
            if (!session) {
                const authorized = this.isAuthorized();
                return protocolFailure(
                    authorized ? 500 : 401,
                    authorized ? 'Session initialization failed' : 'Unauthorized',
                );
            }
        }

        session.lastUsed = Date.now();
        try {
            return await session.transport.handleRequest(request, { parsedBody: body });
        } finally {
            if (this.pending === session) {
                this.pending = undefined;
                await session.server.close();
            }
        }
    }

    public closeIdle(): void {
        const active = this.active;
        if (active && Date.now() - active.session.lastUsed >= idleMs) {
            this.active = undefined;
            void active.session.server.close().catch(() => this.options.onError('MCP idle session close failed'));
        }
    }

    public async close(): Promise<void> {
        const sessions = [this.active?.session, this.pending].filter(session => session !== undefined);
        this.active = undefined;
        this.pending = undefined;
        await Promise.all(sessions.map(session => session.server.close()));
    }

    private async replaceSession(): Promise<Session | undefined> {
        const session = new Session(
            this.options,
            this.getAuthority(),
            (id, initialized) => {
                if (this.pending === initialized) {
                    this.pending = undefined;
                    this.active = { id, session: initialized };
                }
            },
            id => {
                if (this.active?.id === id) {
                    this.active = undefined;
                }
            },
        );
        const previous = this.active;
        this.active = undefined;
        this.pending = session;

        try {
            await previous?.session.server.close();
            await this.options.registerTools(session.server);
            if (!this.isAuthorized()) {
                this.pending = undefined;
                await session.server.close();
                return undefined;
            }
            await session.server.connect(session.transport);
            return session;
        } catch {
            this.pending = undefined;
            await session.server.close();
            this.options.onError('MCP session initialization failed');
            return undefined;
        }
    }
}

export function protocolFailure(status: number, message: string): Response {
    return Response.json({
        jsonrpc: '2.0',
        error: { code: -32000, message },
        id: null,
    }, { status });
}
