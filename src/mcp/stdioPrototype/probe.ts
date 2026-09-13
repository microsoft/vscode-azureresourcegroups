/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CopilotTool } from '@microsoft/vscode-inproc-mcp';
import { setTimeout as delay } from 'node:timers/promises';
import * as vscode from 'vscode';
import { z } from 'zod/mini';
import type { ConnectionLease } from './connection';

export function registerProbe(context: Pick<vscode.ExtensionContext, 'subscriptions'>, lease: ConnectionLease, log: (line: string) => void): CopilotTool<ReturnType<typeof probeInput>, typeof probeOutput> {
    const inputSchema = probeInput(lease.instance);
    let count = 0;
    let disposed = false;
    context.subscriptions.push({ dispose: () => { disposed = true; } });
    context.subscriptions.push(vscode.commands.registerCommand('copilotOnRails.mcpStdioProbe', async (value: unknown, signal?: AbortSignal) => {
        assertPrototypeAccess(lease, disposed);
        const input = inputSchema.parse(value);
        if (input.action === 'fail') {
            throw new Error('Requested prototype tool failure.');
        }
        await delay(input.delayMs, undefined, { signal });
        assertPrototypeAccess(lease, disposed);
        signal?.throwIfAborted();
        count++;
        log(`probe instance=${lease.instance} count=${count}`);
        return { instance: lease.instance, count };
    }));
    return {
        name: 'cor_stdio_probe',
        description: 'Run the fixed harmless Azure Resources prototype command in this window. The instance value in the schema is an opaque marker, not a credential.',
        inputSchema,
        outputSchema: probeOutput,
        annotations: { destructiveHint: false, openWorldHint: false },
        execute: async (input, extras) => {
            assertPrototypeAccess(lease, disposed);
            return await vscode.commands.executeCommand<z.infer<typeof probeOutput>>('copilotOnRails.mcpStdioProbe', input, extras?.signal);
        },
    };
}

function probeInput(instance: string) {
    return z.strictObject({
        instance: z.literal(instance),
        action: z._default(z.enum(['echo', 'fail']), 'echo'),
        delayMs: z._default(z.number().check(z.int(), z.minimum(0), z.maximum(5000)), 0),
    });
}

const probeOutput = z.object({ instance: z.uuid(), count: z.number().check(z.int(), z.positive()) });

export function assertPrototypeAccess(lease: ConnectionLease, disposed = false): void {
    if (disposed || Date.now() >= lease.expiresAt) {
        throw new Error('Prototype window lease expired or was revoked.');
    }
    if (!vscode.workspace.isTrusted || vscode.env.remoteName ||
        JSON.stringify(vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString()) ?? []) !== JSON.stringify(lease.workspace)) {
        throw new Error('Prototype requires its original trusted local workspace.');
    }
}
