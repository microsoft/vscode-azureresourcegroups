/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { McpServer } from '@modelcontextprotocol/server';

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
    registerTools: (server: McpServer, isAuthorized: () => boolean) => void | Promise<void>;
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
