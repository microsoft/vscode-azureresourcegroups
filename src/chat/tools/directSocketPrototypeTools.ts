/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import * as vscode from 'vscode';
import { z } from 'zod';

export const prototypeIdentityCommand = 'copilotOnRails.prototype1.instance';

export function registerDirectSocketPrototypeTools(server: McpServer, options: {
    instance: string;
    assertAllowed: () => void;
    openNextSteps: (context: ServerContext) => Promise<unknown>;
    record: (event: string) => void;
}): void {
    server.registerTool('prototype_instance', {
        description: 'Return the opaque identity of this test-only VS Code extension instance using its fixed canary command.',
        inputSchema: z.strictObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async () => {
        options.assertAllowed();
        const result = await vscode.commands.executeCommand<{ instance: string; protocol: number }>(prototypeIdentityCommand);
        if (result?.instance !== options.instance) {
            throw new Error('Prototype identity command returned the wrong extension instance.');
        }
        options.record('identity-tool');
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
    server.registerTool('open_scaffold_next_steps_view', {
        description: 'Open the project scaffold "Next Steps" webview.',
        annotations: { openWorldHint: false, destructiveHint: false },
        inputSchema: z.strictObject({}),
    }, async (_, context) => {
        options.assertAllowed();
        const result = await options.openNextSteps(context);
        options.record('next-steps-open');
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
}
