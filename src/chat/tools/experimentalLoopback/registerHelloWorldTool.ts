/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

export function registerHelloWorldTool(server: McpServer): void {
    server.registerTool('hello_world', {
        description: 'Return a hello-world response for testing the MCP connection.',
        inputSchema: z.strictObject({}),
        annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            destructiveHint: false,
            openWorldHint: false,
        },
    }, async () => ({
        content: [{ type: 'text', text: 'Hello from Azure Resources MCP!' }],
    }));
}
