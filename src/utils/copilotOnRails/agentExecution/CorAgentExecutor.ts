/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface CorAgentToolDefinition {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
    handler(args: unknown): Promise<unknown> | unknown;
}

export interface CorAgentRunRequest {
    agentName: string;
    prompt: string;
    workingDirectory: string;
    model?: string;
    timeoutMs?: number;
    /**
     * Maximum silence between session events before the run is treated as stalled. Guards
     * against upstream turns that start and never return, which otherwise consume the whole
     * `timeoutMs` budget without producing any evidence.
     */
    stallTimeoutMs?: number;
    tools?: CorAgentToolDefinition[];
    builtInTools?: string[];
    additionalSystemMessage?: string;
    completionToolNames?: string[];
}

export interface CorAgentUsageSummary {
    apiCalls: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    totalNanoAiu: number;
    models: string[];
}

export interface CorAgentToolCallSummary {
    toolCallId: string;
    toolName: string;
    startedAt: string;
    completedAt?: string;
    success?: boolean;
    error?: string;
}

export type CorAgentCapturedValue =
    | null
    | boolean
    | number
    | string
    | CorAgentCapturedValue[]
    | { [key: string]: CorAgentCapturedValue };

interface CorAgentTimelineEventBase {
    timestamp: string;
    agentId?: string;
    turnId?: string;
}

export interface CorAgentAssistantMessageEvent extends CorAgentTimelineEventBase {
    type: 'assistant.message';
    messageId: string;
    model?: string;
    content: string;
    contentTruncated?: boolean;
    contentRedacted?: boolean;
}

export interface CorAgentAssistantTurnEvent extends CorAgentTimelineEventBase {
    type: 'assistant.turn_start' | 'assistant.turn_end';
    turnId: string;
    model?: string;
}

export interface CorAgentToolExecutionStartEvent extends CorAgentTimelineEventBase {
    type: 'tool.execution_start';
    toolCallId: string;
    toolName: string;
    model?: string;
    arguments?: CorAgentCapturedValue;
    argumentsTruncated?: boolean;
    argumentsRedacted?: boolean;
}

export interface CorAgentToolExecutionCompleteEvent extends CorAgentTimelineEventBase {
    type: 'tool.execution_complete';
    toolCallId: string;
    toolName?: string;
    model?: string;
    success: boolean;
    error?: string;
    result?: string;
    resultTruncated?: boolean;
    resultRedacted?: boolean;
}

export interface CorAgentUsageEvent extends CorAgentTimelineEventBase {
    type: 'assistant.usage';
    apiCallId?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalNanoAiu?: number;
}

export interface CorAgentSessionErrorEvent extends CorAgentTimelineEventBase {
    type: 'session.error';
    errorType: string;
    errorCode?: string;
    statusCode?: number;
    message: string;
    messageTruncated?: boolean;
    messageRedacted?: boolean;
}

/**
 * A bounded, redacted projection of observable Copilot SDK events. It intentionally excludes
 * reasoning and permission events and has no dependency on either the SDK or Vally.
 */
export type CorAgentTimelineEvent =
    | CorAgentAssistantMessageEvent
    | CorAgentAssistantTurnEvent
    | CorAgentToolExecutionStartEvent
    | CorAgentToolExecutionCompleteEvent
    | CorAgentUsageEvent
    | CorAgentSessionErrorEvent;

export type CorAgentRunOutcome = 'completed' | 'failed' | 'timedOut';

export interface CorAgentRunResult {
    outcome: CorAgentRunOutcome;
    sessionId?: string;
    finalMessage?: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    usage: CorAgentUsageSummary;
    toolCalls: CorAgentToolCallSummary[];
    errors: string[];
    /**
     * Present for new SDK-backed runs, including when no supported events were emitted. Historical
     * run summaries omit this field and are therefore explicitly distinguishable as summary-only.
     */
    eventTimeline?: CorAgentTimelineEvent[];
}

export interface CorAgentExecutor {
    run(request: CorAgentRunRequest): Promise<CorAgentRunResult>;
}

export interface CorAgentEventCapture {
    usage: CorAgentUsageSummary;
    toolCalls: CorAgentToolCallSummary[];
    errors: string[];
    eventTimeline: CorAgentTimelineEvent[];
    pendingToolCallIndexes: Record<string, number>;
}

interface ObservableSdkEvent {
    type: string;
    timestamp?: unknown;
    agentId?: unknown;
    data?: unknown;
}

const maxAssistantMessageChars = 32_000;
const maxToolArgumentsChars = 12_000;
const maxToolResultChars = 8_000;
const maxErrorChars = 4_000;
const sensitiveKeyPattern = /(?:authorization|connection.?string|credential|password|passwd|pwd|secret|token|api.?key|account.?key|shared.?key)/i;

export function createCorAgentEventCapture(): CorAgentEventCapture {
    return {
        usage: {
            apiCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            totalNanoAiu: 0,
            models: [],
        },
        toolCalls: [],
        errors: [],
        eventTimeline: [],
        pendingToolCallIndexes: {},
    };
}

export function appendCorAgentCaptureError(
    capture: CorAgentEventCapture,
    message: string,
): CorAgentEventCapture {
    const safe = sanitizeText(message, maxErrorChars);
    return {
        ...capture,
        errors: [...capture.errors, safe.value],
    };
}

/**
 * Purely reduces one observable SDK event into serializable capture state.
 */
export function reduceCorAgentEvent(
    previous: CorAgentEventCapture,
    rawEvent: ObservableSdkEvent,
): CorAgentEventCapture {
    const event = asRecord(rawEvent);
    const data = asRecord(event?.data);
    const timestamp = stringValue(event?.timestamp);
    if (!event || !data || !timestamp) {
        return previous;
    }
    const agentId = stringValue(event.agentId);
    const type = stringValue(event.type);
    const base = {
        timestamp,
        ...(agentId ? { agentId } : {}),
    };

    switch (type) {
        case 'assistant.message': {
            const messageId = stringValue(data.messageId);
            const content = stringValue(data.content);
            if (!messageId || content === undefined) {
                return previous;
            }
            const safe = sanitizeText(content, maxAssistantMessageChars);
            return appendTimeline(previous, {
                ...base,
                type,
                messageId,
                ...optionalString(data.turnId, 'turnId'),
                ...optionalString(data.model, 'model'),
                content: safe.value,
                ...(safe.truncated ? { contentTruncated: true } : {}),
                ...(safe.redacted ? { contentRedacted: true } : {}),
            });
        }
        case 'assistant.turn_start':
        case 'assistant.turn_end': {
            const turnId = stringValue(data.turnId);
            if (!turnId) {
                return previous;
            }
            return appendTimeline(previous, {
                ...base,
                type,
                turnId,
                ...optionalString(data.model, 'model'),
            });
        }
        case 'tool.execution_start': {
            const toolCallId = stringValue(data.toolCallId);
            const toolName = stringValue(data.toolName);
            if (!toolCallId || !toolName) {
                return previous;
            }
            const safeArguments = data.arguments === undefined
                ? undefined
                : sanitizeValue(data.arguments, maxToolArgumentsChars);
            const call: CorAgentToolCallSummary = {
                toolCallId,
                toolName,
                startedAt: timestamp,
            };
            const toolCalls = [...previous.toolCalls, call];
            return {
                ...previous,
                toolCalls,
                pendingToolCallIndexes: {
                    ...previous.pendingToolCallIndexes,
                    [toolCallId]: toolCalls.length - 1,
                },
                eventTimeline: [...previous.eventTimeline, {
                    ...base,
                    type,
                    toolCallId,
                    toolName,
                    ...optionalString(data.turnId, 'turnId'),
                    ...optionalString(data.model, 'model'),
                    ...(safeArguments ? { arguments: safeArguments.value } : {}),
                    ...(safeArguments?.truncated ? { argumentsTruncated: true } : {}),
                    ...(safeArguments?.redacted ? { argumentsRedacted: true } : {}),
                }],
            };
        }
        case 'tool.execution_complete': {
            const toolCallId = stringValue(data.toolCallId);
            if (!toolCallId || typeof data.success !== 'boolean') {
                return previous;
            }
            const pendingIndex = previous.pendingToolCallIndexes[toolCallId];
            const pending = pendingIndex === undefined ? undefined : previous.toolCalls[pendingIndex];
            const errorRecord = asRecord(data.error);
            const rawError = stringValue(errorRecord?.message);
            const safeError = rawError === undefined ? undefined : sanitizeText(rawError, maxErrorChars);
            const resultRecord = asRecord(data.result);
            const rawResult = stringValue(resultRecord?.content);
            const safeResult = rawResult === undefined ? undefined : sanitizeText(rawResult, maxToolResultChars);
            const toolCalls = [...previous.toolCalls];
            if (pending && pendingIndex !== undefined) {
                toolCalls[pendingIndex] = {
                    ...pending,
                    completedAt: timestamp,
                    success: data.success,
                    ...(safeError ? { error: safeError.value } : {}),
                };
            }
            const pendingToolCallIndexes = { ...previous.pendingToolCallIndexes };
            delete pendingToolCallIndexes[toolCallId];
            return {
                ...previous,
                toolCalls,
                pendingToolCallIndexes,
                eventTimeline: [...previous.eventTimeline, {
                    ...base,
                    type,
                    toolCallId,
                    ...(pending?.toolName ? { toolName: pending.toolName } : {}),
                    ...optionalString(data.turnId, 'turnId'),
                    ...optionalString(data.model, 'model'),
                    success: data.success,
                    ...(safeError ? { error: safeError.value } : {}),
                    ...(safeResult ? { result: safeResult.value } : {}),
                    ...(safeResult?.truncated ? { resultTruncated: true } : {}),
                    ...(safeResult?.redacted ? { resultRedacted: true } : {}),
                }],
            };
        }
        case 'assistant.usage': {
            const model = stringValue(data.model);
            if (!model) {
                return previous;
            }
            const inputTokens = nonNegativeNumber(data.inputTokens);
            const outputTokens = nonNegativeNumber(data.outputTokens);
            const reasoningTokens = nonNegativeNumber(data.reasoningTokens);
            const cacheReadTokens = nonNegativeNumber(data.cacheReadTokens);
            const cacheWriteTokens = nonNegativeNumber(data.cacheWriteTokens);
            const copilotUsage = asRecord(data.copilotUsage);
            const totalNanoAiu = optionalNonNegativeNumber(copilotUsage?.totalNanoAiu);
            const models = previous.usage.models.includes(model)
                ? previous.usage.models
                : [...previous.usage.models, model];
            return {
                ...previous,
                usage: {
                    apiCalls: previous.usage.apiCalls + 1,
                    inputTokens: previous.usage.inputTokens + inputTokens,
                    outputTokens: previous.usage.outputTokens + outputTokens,
                    reasoningTokens: previous.usage.reasoningTokens + reasoningTokens,
                    cacheReadTokens: previous.usage.cacheReadTokens + cacheReadTokens,
                    totalNanoAiu: previous.usage.totalNanoAiu + (totalNanoAiu ?? 0),
                    models,
                },
                eventTimeline: [...previous.eventTimeline, {
                    ...base,
                    type,
                    ...optionalString(data.apiCallId, 'apiCallId'),
                    model,
                    inputTokens,
                    outputTokens,
                    reasoningTokens,
                    cacheReadTokens,
                    cacheWriteTokens,
                    ...(totalNanoAiu === undefined ? {} : { totalNanoAiu }),
                }],
            };
        }
        case 'session.error': {
            const message = stringValue(data.message);
            const errorType = stringValue(data.errorType);
            if (!message || !errorType) {
                return previous;
            }
            const safe = sanitizeText(message, maxErrorChars);
            return {
                ...previous,
                errors: [...previous.errors, safe.value],
                eventTimeline: [...previous.eventTimeline, {
                    ...base,
                    type,
                    errorType,
                    ...optionalString(data.errorCode, 'errorCode'),
                    ...optionalNumber(data.statusCode, 'statusCode'),
                    message: safe.value,
                    ...(safe.truncated ? { messageTruncated: true } : {}),
                    ...(safe.redacted ? { messageRedacted: true } : {}),
                }],
            };
        }
        default:
            return previous;
    }
}

interface Sanitized<T> {
    value: T;
    truncated: boolean;
    redacted: boolean;
}

function appendTimeline(
    capture: CorAgentEventCapture,
    event: CorAgentTimelineEvent,
): CorAgentEventCapture {
    return {
        ...capture,
        eventTimeline: [...capture.eventTimeline, event],
    };
}

function sanitizeValue(value: unknown, maxChars: number): Sanitized<CorAgentCapturedValue> {
    const flags = { redacted: false, truncated: false };
    const safe = sanitizeJsonValue(value, flags);
    const serialized = JSON.stringify(safe);
    if (serialized.length <= maxChars) {
        return { value: safe, truncated: flags.truncated, redacted: flags.redacted };
    }
    const excerpt = sanitizeText(serialized, maxChars);
    return {
        value: {
            truncated: true,
            excerpt: excerpt.value,
        },
        truncated: true,
        redacted: flags.redacted || excerpt.redacted,
    };
}

function sanitizeJsonValue(
    value: unknown,
    flags: { redacted: boolean; truncated: boolean },
    key?: string,
): CorAgentCapturedValue {
    if (key && sensitiveKeyPattern.test(key)) {
        flags.redacted = true;
        return '[REDACTED]';
    }
    if (value === null || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : String(value);
    }
    if (typeof value === 'string') {
        const safe = sanitizeText(value, 4_000);
        flags.redacted ||= safe.redacted;
        return safe.value;
    }
    if (Array.isArray(value)) {
        flags.truncated ||= value.length > 100;
        return value.slice(0, 100).map(item => sanitizeJsonValue(item, flags));
    }
    const record = asRecord(value);
    if (!record) {
        return String(value);
    }
    const entries = Object.entries(record);
    flags.truncated ||= entries.length > 100;
    return Object.fromEntries(
        entries
            .slice(0, 100)
            .map(([childKey, child]) => [childKey, sanitizeJsonValue(child, flags, childKey)]),
    );
}

function sanitizeText(value: string, maxChars: number): Sanitized<string> {
    let redacted = false;
    const replace = (_match: string, prefix: string): string => {
        redacted = true;
        return `${prefix}[REDACTED]`;
    };
    let safe = value
        .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, replace)
        .replace(
            /\b((?:password|passwd|pwd|token|secret|api[_-]?key|accountkey|sharedaccesskey|connectionstring)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^;\s,}]+)/gi,
            replace,
        )
        .replace(/(https?:\/\/[^:/\s]+:)[^@\s/]+@/gi, replace);
    const truncated = safe.length > maxChars;
    if (truncated) {
        const omitted = safe.length - maxChars;
        safe = `${safe.slice(0, maxChars)}…[truncated ${omitted} chars]`;
    }
    return { value: safe, truncated, redacted };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object'
        ? value as Record<string, unknown>
        : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function optionalString<K extends string>(
    value: unknown,
    key: K,
): { [P in K]?: string } {
    const text = stringValue(value);
    return text === undefined ? {} : { [key]: text } as { [P in K]?: string };
}

function optionalNumber<K extends string>(
    value: unknown,
    key: K,
): { [P in K]?: number } {
    return typeof value === 'number' && Number.isFinite(value)
        ? { [key]: value } as { [P in K]?: number }
        : {};
}

function nonNegativeNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
