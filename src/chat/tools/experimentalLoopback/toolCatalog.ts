/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod';

export const markerToolName = 'experimental_loopback_instance_marker';
export const nextStepsToolName = 'open_scaffold_next_steps_view';
export const markerCommandId = 'azureResourceGroups.experimentalMcpHttp.instanceMarker';

export interface PrototypeHandlers {
    isTrusted: () => boolean;
    marker: (context: ServerContext) => Promise<string>;
    nextSteps: (context: ServerContext) => Promise<{ message: string }>;
}

export function createPrototypeToolRegistrar(handlers: PrototypeHandlers): (server: McpServer, authorized: () => boolean) => void {
    let viewInFlight = false;
    let inFlight = 0;
    return (server, authorized) => {
        function check(context: ServerContext): void {
            if (!authorized() || !handlers.isTrusted()) {
                throw new Error('Prototype lease or trusted workspace required');
            }
            context.mcpReq.signal.throwIfAborted();
            if (inFlight >= 4) {
                throw new Error('Prototype tool concurrency limit reached');
            }
        }
        server.registerTool(markerToolName, {
            description: 'Return the opaque marker of this test VS Code window through one fixed command.',
            inputSchema: z.strictObject({}),
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        }, async (_input, context) => {
            check(context);
            inFlight++;
            try {
                const marker = await handlers.marker(context);
                return { content: [{ type: 'text', text: marker }], structuredContent: { marker } };
            } finally {
                inFlight--;
            }
        });
        server.registerTool(nextStepsToolName, {
            description: 'Open the existing project scaffold Next Steps view in this test window. Do not click its workflow actions during the prototype.',
            inputSchema: z.strictObject({}),
            annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        }, async (_input, context) => {
            check(context);
            if (viewInFlight) {
                throw new Error('Next Steps view invocation already in progress');
            }
            viewInFlight = true;
            inFlight++;
            try {
                const result = await handlers.nextSteps(context);
                return { content: [{ type: 'text', text: result.message }], structuredContent: result };
            } finally {
                inFlight--;
                viewInFlight = false;
            }
        });
    };
}
