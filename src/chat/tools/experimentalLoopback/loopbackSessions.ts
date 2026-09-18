/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isInitializeRequest, McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { randomUUID } from 'node:crypto';
import { protocolFailure } from './loopbackResponses';
import { loopbackLimits, type LoopbackOptions } from './loopbackTypes';

class Session {
    public readonly server: McpServer;
    public readonly transport: WebStandardStreamableHTTPServerTransport;
    public lastUsed = Date.now();

    public constructor(
        id: string,
        version: string,
        authority: string,
        onInitialized: (id: string, session: Session) => void,
        onClosed: (id: string) => void,
    ) {
        this.server = new McpServer({ name: id, version });
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
    private readonly active = new Map<string, Session>();
    private readonly pending = new Set<Session>();

    public constructor(
        private readonly options: LoopbackOptions,
        private readonly getAuthority: () => string,
        private readonly isAuthorized: () => boolean,
    ) { }

    public async handle(request: Request): Promise<Response> {
        const sessionId = request.headers.get('mcp-session-id');
        let session = sessionId ? this.active.get(sessionId) : undefined;
        if (sessionId && !session) {
            return protocolFailure(404, 'Session terminated or unknown');
        }

        let parsedBody: unknown;
        if (request.method === 'POST') {
            try {
                parsedBody = await request.json();
            } catch {
                return protocolFailure(400, 'Invalid JSON body');
            }
        }
        if (!this.isAuthorized()) {
            return protocolFailure(401, 'Unauthorized');
        }
        if (!session) {
            if (request.method !== 'POST' || !isInitializeRequest(parsedBody)) {
                return protocolFailure(400, 'Initialization required');
            }
            if (this.active.size + this.pending.size >= loopbackLimits.sessions) {
                return protocolFailure(429, 'Too many sessions');
            }
            session = await this.createSession();
            if (!session) {
                return this.isAuthorized()
                    ? protocolFailure(500, 'Session initialization failed')
                    : protocolFailure(401, 'Unauthorized');
            }
        }

        session.lastUsed = Date.now();
        try {
            return await session.transport.handleRequest(request, { parsedBody });
        } finally {
            if (this.pending.delete(session)) {
                await session.server.close();
            }
        }
    }

    public closeIdle(): void {
        for (const [id, session] of this.active) {
            if (Date.now() - session.lastUsed >= loopbackLimits.idleMs) {
                this.active.delete(id);
                void session.server.close().catch(() => this.options.onError('MCP idle session close failed'));
            }
        }
    }

    public async close(): Promise<void> {
        const sessions = [...this.active.values(), ...this.pending];
        this.active.clear();
        this.pending.clear();
        await Promise.all(sessions.map(session => session.server.close()));
    }

    private async createSession(): Promise<Session | undefined> {
        const authority = this.getAuthority();
        const session = new Session(
            this.options.id,
            this.options.version,
            authority,
            (id, initializedSession) => {
                this.pending.delete(initializedSession);
                this.active.set(id, initializedSession);
            },
            id => {
                this.active.delete(id);
            },
        );
        this.pending.add(session);
        try {
            await this.options.registerTools(session.server, this.isAuthorized);
            if (!this.isAuthorized()) {
                this.pending.delete(session);
                await session.server.close();
                return undefined;
            }
            await session.server.connect(session.transport);
            return session;
        } catch {
            this.pending.delete(session);
            await session.server.close();
            this.options.onError('MCP session initialization failed');
            return undefined;
        }
    }
}
