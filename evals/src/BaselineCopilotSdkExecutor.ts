/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    CopilotClientOptions,
    SessionConfig,
    SessionEvent,
} from '@github/copilot-sdk-eval';
import * as path from 'path';
import type {
    CorAgentRunResult,
} from '../../src/utils/copilotOnRails/agentExecution/CorAgentExecutor';
import {
    appendCorAgentCaptureError,
    createCorAgentEventCapture,
    reduceCorAgentEvent,
} from '../../src/utils/copilotOnRails/agentExecution/CorAgentExecutor';

export const baselineWorkspaceFileTools = [
    'apply_patch',
    'create',
    'edit',
    'glob',
    'grep',
    'rg',
    'view',
] as const;

export const baselineAvailableTools = baselineWorkspaceFileTools.map(tool => `builtin:${tool}`);

export const baselineSystemMessage = [
    'Complete the user request directly in the current workspace.',
    'Use only the provided workspace file tools.',
    'Do not use shell, network, MCP, delegation, custom agents, skills, or custom instructions.',
    'Do not ask for user input. Stop when the workspace implementation is complete.',
].join(' ');

export interface BaselineAgentRunRequest {
    prompt: string;
    workingDirectory: string;
    model: string;
    timeoutMs: number;
}

export interface BaselineAgentExecutor {
    run(request: BaselineAgentRunRequest): Promise<CorAgentRunResult>;
}

export function getBaselineStateDirectory(request: Pick<BaselineAgentRunRequest, 'workingDirectory'>): string {
    return path.join(
        path.dirname(request.workingDirectory),
        '.copilot-baseline-state',
        path.basename(request.workingDirectory),
    );
}

export function isBaselineFilePermissionAllowed(
    request: { kind: string; requestSandboxBypass?: boolean; path?: string; fileName?: string },
    workingDirectory: string,
): boolean {
    if (request.requestSandboxBypass || (request.kind !== 'read' && request.kind !== 'write')) {
        return false;
    }
    const requestedPath = request.kind === 'read' ? request.path : request.fileName;
    if (!requestedPath) {
        return false;
    }
    const root = path.resolve(workingDirectory);
    const resolved = path.resolve(root, requestedPath);
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function createBaselineClientOptions(request: BaselineAgentRunRequest): CopilotClientOptions {
    return {
        workingDirectory: request.workingDirectory,
        baseDirectory: getBaselineStateDirectory(request),
        logLevel: 'warning',
        mode: 'empty',
        useLoggedInUser: true,
    };
}

export function createBaselineSessionConfig(request: BaselineAgentRunRequest): SessionConfig {
    return {
        clientName: 'vscode-azureresourcegroups-baseline-evaluation',
        model: request.model,
        availableTools: baselineAvailableTools,
        customAgents: [],
        enableConfigDiscovery: false,
        enableMcpApps: false,
        mcpServers: {},
        pluginDirectories: [],
        requestCanvasRenderer: false,
        requestExtensions: false,
        skillDirectories: [],
        skipCustomInstructions: true,
        systemMessage: {
            mode: 'append',
            content: baselineSystemMessage,
        },
        onPermissionRequest: permission => {
            if (!isBaselineFilePermissionAllowed(permission, request.workingDirectory)) {
                return {
                    kind: 'reject',
                    feedback: `The controlled baseline does not permit this ${permission.kind} operation.`,
                };
            }
            return { kind: 'approve-once' };
        },
        workingDirectory: request.workingDirectory,
    };
}

/**
 * Runs the SDK's generic coding agent without any Copilot-on-Rails prompt, asset, custom tool,
 * or delegation surface.
 */
export class BaselineCopilotSdkExecutor implements BaselineAgentExecutor {
    public async run(request: BaselineAgentRunRequest): Promise<CorAgentRunResult> {
        const started = Date.now();
        let capture = createCorAgentEventCapture();
        const { CopilotClient } = await import('@github/copilot-sdk-eval');
        const client = new CopilotClient(createBaselineClientOptions(request));
        let sessionId: string | undefined;
        let finalMessage: string | undefined;
        let outcome: CorAgentRunResult['outcome'] = 'failed';

        try {
            await client.start();
            const session = await client.createSession(createBaselineSessionConfig(request));
            sessionId = session.sessionId;
            const unsubscribe = session.on((event: SessionEvent) => {
                capture = reduceCorAgentEvent(capture, event);
            });
            try {
                const response = await session.sendAndWait({ prompt: request.prompt }, request.timeoutMs);
                finalMessage = response?.data.content;
                outcome = 'completed';
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
            startedAt: new Date(started).toISOString(),
            completedAt: new Date(completed).toISOString(),
            durationMs: completed - started,
            usage: capture.usage,
            toolCalls: capture.toolCalls,
            errors: capture.errors,
            eventTimeline: capture.eventTimeline,
        };
    }
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
