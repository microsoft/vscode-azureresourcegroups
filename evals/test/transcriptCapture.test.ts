/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-floating-promises -- node:test registrations are intentionally top-level. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
    appendCorAgentCaptureError,
    createCorAgentEventCapture,
    reduceCorAgentEvent,
} from '../../src/utils/copilotOnRails/agentExecution/CorAgentExecutor';

describe('Copilot SDK transcript capture', () => {
    test('retains Rails assistant messages emitted before a completion-tool abort', () => {
        let capture = createCorAgentEventCapture();
        capture = reduce(capture, 'assistant.turn_start', {
            turnId: 'turn-1',
            model: 'test-model',
        }, '2026-08-07T10:00:00.000Z');
        capture = reduce(capture, 'assistant.message', {
            messageId: 'message-1',
            turnId: 'turn-1',
            model: 'test-model',
            content: 'The implementation is ready; handing off completion.',
        }, '2026-08-07T10:00:00.100Z');
        capture = reduce(capture, 'tool.execution_start', {
            toolCallId: 'completion-1',
            toolName: 'complete_scaffold',
            turnId: 'turn-1',
            arguments: { status: 'ready' },
        }, '2026-08-07T10:00:00.200Z');
        capture = reduce(capture, 'tool.execution_complete', {
            toolCallId: 'completion-1',
            turnId: 'turn-1',
            success: true,
            result: { content: 'accepted' },
        }, '2026-08-07T10:00:00.300Z');

        assert.equal(
            capture.eventTimeline.find(event => event.type === 'assistant.message')?.content,
            'The implementation is ready; handing off completion.',
        );
        assert.equal(capture.toolCalls[0].success, true);
    });

    test('retains baseline messages when the SDK reaches idle', () => {
        let capture = createCorAgentEventCapture();
        capture = reduce(capture, 'assistant.message', {
            messageId: 'baseline-message',
            turnId: 'baseline-turn',
            model: 'test-model',
            content: 'Baseline work completed.',
        }, '2026-08-07T10:01:00.000Z');
        capture = reduce(capture, 'assistant.idle', {
            aborted: false,
        }, '2026-08-07T10:01:00.100Z');

        assert.deepEqual(
            capture.eventTimeline.map(event => event.type),
            ['assistant.message'],
        );
    });

    test('captures tool, usage, and error identity without hidden reasoning', () => {
        let capture = createCorAgentEventCapture();
        capture = reduce(capture, 'tool.execution_start', {
            toolCallId: 'tool-1',
            toolName: 'view',
            turnId: 'turn-2',
            model: 'test-model',
            arguments: { path: 'src/index.ts' },
        }, '2026-08-07T10:02:00.000Z', 'subagent-1');
        capture = reduce(capture, 'tool.execution_complete', {
            toolCallId: 'tool-1',
            turnId: 'turn-2',
            model: 'test-model',
            success: false,
            error: { message: 'file missing' },
            result: { content: 'ENOENT' },
        }, '2026-08-07T10:02:00.100Z', 'subagent-1');
        capture = reduce(capture, 'assistant.usage', {
            apiCallId: 'api-1',
            model: 'test-model',
            inputTokens: 10,
            outputTokens: 4,
            reasoningTokens: 2,
            cacheReadTokens: 3,
            cacheWriteTokens: 1,
            copilotUsage: { totalNanoAiu: 25 },
        }, '2026-08-07T10:02:00.200Z', 'subagent-1');
        capture = reduce(capture, 'session.error', {
            errorType: 'query',
            errorCode: 'bad_query',
            statusCode: 400,
            message: 'request failed',
        }, '2026-08-07T10:02:00.300Z', 'subagent-1');
        capture = reduce(capture, 'assistant.reasoning', {
            content: 'must not be captured',
        }, '2026-08-07T10:02:00.400Z', 'subagent-1');

        assert.deepEqual(
            capture.eventTimeline.map(event => event.type),
            ['tool.execution_start', 'tool.execution_complete', 'assistant.usage', 'session.error'],
        );
        assert.equal(capture.usage.models[0], 'test-model');
        assert.equal(capture.usage.totalNanoAiu, 25);
        assert.equal(capture.errors[0], 'request failed');
        assert.doesNotMatch(JSON.stringify(capture), /must not be captured/);
    });

    test('redacts obvious credentials and truncates large arguments, results, and messages', () => {
        let capture = createCorAgentEventCapture();
        capture = reduce(capture, 'assistant.message', {
            messageId: 'message-secret',
            content: `token=visible ${'m'.repeat(33_000)}`,
        }, '2026-08-07T10:03:00.000Z');
        capture = reduce(capture, 'tool.execution_start', {
            toolCallId: 'tool-secret',
            toolName: 'create',
            arguments: {
                password: 'do-not-store',
                connectionString: 'AccountKey=do-not-store',
                content: 'a'.repeat(13_000),
            },
        }, '2026-08-07T10:03:00.100Z');
        capture = reduce(capture, 'tool.execution_complete', {
            toolCallId: 'tool-secret',
            success: true,
            result: { content: `Bearer abc.def ${'r'.repeat(9_000)}` },
        }, '2026-08-07T10:03:00.200Z');
        capture = appendCorAgentCaptureError(
            capture,
            `password=do-not-store ${'e'.repeat(5_000)}`,
        );

        const serialized = JSON.stringify(capture);
        assert.doesNotMatch(serialized, /visible|do-not-store|abc\.def/);
        assert.match(serialized, /\[REDACTED\]/);
        assert.match(serialized, /truncated/);
        assert(serialized.length < 60_000);
    });
});

function reduce(
    capture: ReturnType<typeof createCorAgentEventCapture>,
    type: string,
    data: Record<string, unknown>,
    timestamp: string,
    agentId?: string,
): ReturnType<typeof createCorAgentEventCapture> {
    return reduceCorAgentEvent(capture, {
        type,
        timestamp,
        ...(agentId ? { agentId } : {}),
        data,
    });
}
