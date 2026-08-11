/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SessionEvent,
    Tool,
} from '@github/copilot-sdk-eval';
import { realpathSync } from 'fs';
import * as path from 'path';
import {
    CorAgentExecutor,
    CorAgentRunRequest,
    CorAgentRunResult,
    appendCorAgentCaptureError,
    createCorAgentEventCapture,
    reduceCorAgentEvent,
} from '../../src/utils/copilotOnRails/agentExecution/CorAgentExecutor';
import { loadAgentSystemPrompt } from './agentAssets';

const defaultTimeoutMs = 5 * 60 * 1000;
const evaluationBuiltInTools = [
    'apply_patch',
    'create',
    'edit',
    'glob',
    'grep',
    'rg',
    'view',
] as const;

export class CopilotSdkAgentExecutor implements CorAgentExecutor {
    public constructor(private readonly repoRoot: string) {
    }

    public async run(request: CorAgentRunRequest): Promise<CorAgentRunResult> {
        const started = Date.now();
        const startedAt = new Date(started).toISOString();
        let capture = createCorAgentEventCapture();
        const { CopilotClient, ToolSet } = await import('@github/copilot-sdk-eval');
        const client = new CopilotClient({
            workingDirectory: request.workingDirectory,
            logLevel: 'warning',
            useLoggedInUser: true,
        });
        let sessionId: string | undefined;
        let finalMessage: string | undefined;
        let outcome: CorAgentRunResult['outcome'];
        let resolveCompletion: ((toolName: string) => void) | undefined;
        const completion = new Promise<string>(resolve => {
            resolveCompletion = resolve;
        });
        const completionToolNames = new Set(request.completionToolNames ?? []);

        try {
            await client.start();
            const session = await client.createSession({
                clientName: 'vscode-azureresourcegroups-evaluation',
                model: request.model,
                tools: request.tools?.map(tool => toSdkTool(
                    tool,
                    completionToolNames.has(tool.name) ? () => resolveCompletion?.(tool.name) : undefined,
                )),
                availableTools: new ToolSet()
                    .addBuiltIn(request.builtInTools ?? evaluationBuiltInTools)
                    .addCustom('*'),
                systemMessage: {
                    mode: 'append',
                    content: await loadAgentSystemPrompt(this.repoRoot, request.agentName, request.additionalSystemMessage),
                },
                onPermissionRequest: permission => {
                    if (!isTreatmentPermissionAllowed(permission, request.workingDirectory)) {
                        return {
                            kind: 'reject',
                            feedback: `The Phase 0 evaluation does not permit this ${permission.kind} operation.`,
                        };
                    }
                    return { kind: 'approve-once' };
                },
            });
            sessionId = session.sessionId;
            const unsubscribe = session.on((event: SessionEvent) => {
                capture = reduceCorAgentEvent(capture, event);
            });
            try {
                const responsePromise = session.sendAndWait(
                    { prompt: request.prompt },
                    request.timeoutMs ?? defaultTimeoutMs,
                );
                const settled = await Promise.race([
                    responsePromise.then(
                        response => ({ kind: 'idle' as const, response }),
                        error => ({ kind: 'error' as const, error }),
                    ),
                    completionToolNames.size
                        ? completion.then(toolName => ({ kind: 'completion' as const, toolName }))
                        : new Promise<never>(() => undefined),
                ]);
                if (settled.kind === 'completion') {
                    await session.abort();
                    await responsePromise.catch(() => undefined);
                    outcome = 'completed';
                } else if (settled.kind === 'error') {
                    throw settled.error;
                } else {
                    finalMessage = settled.response?.data.content;
                    outcome = 'completed';
                }
            } catch (error) {
                const message = getErrorMessage(error);
                capture = appendCorAgentCaptureError(capture, message);
                outcome = /timed?\s*out|timeout/i.test(message) ? 'timedOut' : 'failed';
            } finally {
                unsubscribe();
                try {
                    await session.disconnect();
                } catch (error) {
                    capture = appendCorAgentCaptureError(capture, `SDK cleanup: ${getErrorMessage(error)}`);
                    outcome = 'failed';
                }
            }
        } catch (error) {
            capture = appendCorAgentCaptureError(capture, getErrorMessage(error));
            outcome = 'failed';
        }

        try {
            const stopErrors = await client.stop();
            for (const error of stopErrors) {
                capture = appendCorAgentCaptureError(capture, `SDK cleanup: ${error.message}`);
            }
            if (stopErrors.length) {
                outcome = 'failed';
            }
        } catch (error) {
            capture = appendCorAgentCaptureError(capture, `SDK cleanup: ${getErrorMessage(error)}`);
            outcome = 'failed';
        }
        const completed = Date.now();
        return {
            outcome,
            sessionId,
            finalMessage,
            startedAt,
            completedAt: new Date(completed).toISOString(),
            durationMs: completed - started,
            usage: capture.usage,
            toolCalls: capture.toolCalls,
            errors: capture.errors,
            eventTimeline: capture.eventTimeline,
        };
    }
}

export function isTreatmentPermissionAllowed(
    permission: unknown,
    workingDirectory: string,
): boolean {
    if (!permission || typeof permission !== 'object') {
        return false;
    }
    const request = permission as Record<string, unknown>;
    if (
        request.kind === 'shell'
        || request.kind === 'url'
        || request.kind === 'mcp'
        || request.requestSandboxBypass === true
    ) {
        return false;
    }
    if (request.kind === 'custom-tool') {
        return true;
    }
    if (request.kind !== 'read' && request.kind !== 'write') {
        return false;
    }
    const requestedPaths: string[] = [];
    for (const field of ['path', 'fileName', 'directory']) {
        const value = request[field];
        if (value === undefined) {
            continue;
        }
        if (typeof value !== 'string' || !value) {
            return false;
        }
        requestedPaths.push(value);
    }
    if (!requestedPaths.length) {
        return false;
    }
    const root = canonicalizePath(workingDirectory);
    if (!root) {
        return false;
    }
    for (const requestedPath of requestedPaths) {
        const resolved = path.isAbsolute(requestedPath)
            ? path.resolve(requestedPath)
            : path.resolve(root, requestedPath);
        const canonicalRequestedPath = canonicalizePath(resolved);
        if (!canonicalRequestedPath) {
            return false;
        }
        const relative = path.relative(root, canonicalRequestedPath);
        if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
            return false;
        }
    }
    return true;
}

function canonicalizePath(value: string): string | undefined {
    let existingAncestor = path.resolve(value);
    const missingSegments: string[] = [];
    while (true) {
        try {
            return path.join(realpathSync(existingAncestor), ...missingSegments);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                return undefined;
            }
            const parent = path.dirname(existingAncestor);
            if (parent === existingAncestor) {
                return undefined;
            }
            missingSegments.unshift(path.basename(existingAncestor));
            existingAncestor = parent;
        }
    }
}

function toSdkTool(
    tool: NonNullable<CorAgentRunRequest['tools']>[number],
    onCompleted?: () => void,
): Tool {
    return {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        handler: async args => {
            const result = await tool.handler(args);
            onCompleted?.();
            return result;
        },
    };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
