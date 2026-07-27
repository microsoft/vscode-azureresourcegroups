/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { maskUserInfo, parseError } from "@microsoft/vscode-azext-utils";
import { ext } from "../../extensionVariables";
import { CopilotOnRailsContext, ensureRequiredCopilotOnRailsContext } from "./CopilotOnRailsContext";

// #region prompt
const promptKey: string = 'copilotOnRails.prompt';

export function recordPrompt(prompt: string): void {
    void ext.context.workspaceState.update(promptKey, prompt);
}

export function getPrompt(): string | undefined {
    return ext.context.workspaceState.get<string>(promptKey);
}

// #endregion

// #region createdAt
const createdAtKey: string = 'copilotOnRails.createdAt';

/**
 * Stamps the current time for workspace project diagnostics metadata, as an ISO 8601 string, as the moment the project was first prompted.
 */
export function recordCreatedAt(): void {
    void ext.context.workspaceState.update(createdAtKey, new Date().toISOString());
}

export function getCreatedAt(): string | undefined {
    return ext.context.workspaceState.get<string>(createdAtKey);
}

// #endregion

// #region diagnosticEvents
const maxCachedEvents: number = 50;
const eventsKey: string = 'copilotOnRails.diagnosticEvents';

/**
 * Appends a new immutable event to the cache, stamping it with the current time and
 * trimming to the most recent {@link maxCachedEvents}.
 */
export function recordDiagnosticEvent(event: Omit<DiagnosticEvent, 'timestamp'>): void {
    const entry: DiagnosticEvent = { ...event, timestamp: new Date().toISOString() };
    const events: DiagnosticEvent[] = getDiagnosticEvents();
    events.push(entry);
    void ext.context.workspaceState.update(eventsKey, events.slice(-maxCachedEvents));
}

export function getDiagnosticEvents(): DiagnosticEvent[] {
    return ext.context.workspaceState.get<DiagnosticEvent[]>(eventsKey, []);
}

/**
 * Clears the cached diagnostic events for the current workspace, so a new project
 * starts with an empty event list.
 */
export function clearDiagnosticEvents(): void {
    void ext.context.workspaceState.update(eventsKey, []);
}

/**
 * Aggregates the workspace-cached diagnostics (originating prompt, created-at stamp, and
 * recorded events) into a single {@link DiagnosticsMetadata} object.
 *
 * The returned data is only ever surfaced for inspection or to pre-populate a GitHub issue
 * draft the user reviews - it is never sent to telemetry or submitted automatically.
 */
export function getDiagnosticsMetadata(): DiagnosticsMetadata {
    return {
        prompt: getPrompt() ?? '',
        createdAt: getCreatedAt() ?? '',
        diagnosticEvents: getDiagnosticEvents(),
    };
}

/**
 * Records the lifecycle of a single Copilot on Rails action as a sequence of immutable
 * entries.
 *
 * A `start` entry gets added before a `run`, then either a `success` or `error` entry gets automatically appended after it.
 */
export async function withDiagnosticEvents<T>(
    context: CopilotOnRailsContext,
    eventDetails: Pick<DiagnosticEvent, 'type' | 'name'>,
    run: () => Promise<T>,
): Promise<T> {
    const properties: Record<string, unknown> = ensureRequiredCopilotOnRailsContext(context).diagnostics.properties;
    recordDiagnosticEvent({ name: eventDetails.name, type: eventDetails.type, status: 'start', properties: { ...properties } });

    try {
        const result: T = await run();
        recordDiagnosticEvent({ name: eventDetails.name, type: eventDetails.type, status: 'success', properties: { ...properties } });
        return result;
    } catch (error) {
        recordDiagnosticEvent({ name: eventDetails.name, type: eventDetails.type, status: 'error', properties: { ...properties, error: maskUserInfo(parseError(error).message, context.valuesToMask) } });
        throw error;
    }
}

// #endregion

/**
 * A discrete, immutable entry describing a single action taken during the Copilot
 * on Rails journey. Entries are append-only and never updated after being written,
 * so a single {@link timestamp} fully captures when the event happened.
 *
 * Note: These entries are never sent to telemetry and are never submitted anywhere
 * on the user's behalf. They are workspace-cached and only used to pre-populate a
 * GitHub issue draft that the user reviews and can edit before choosing to submit.
 */
export interface DiagnosticEvent {
    /**
     * When the event occurred, as an ISO 8601 string (`.toISOString()`).
     */
    timestamp: string;
    /**
     * The name of the tool or command that produced the event.
     */
    name: string;
    /**
     * Whether the event was produced by an extension command, an MCP tool, or a webview action.
     */
    type: 'extensionCommand' | 'mcpTool' | 'webviewAction';
    /**
     * Which point in the tool's lifecycle this entry represents.
     */
    status?: 'start' | 'success' | 'error';
    /**
     * A catch-all for any other properties that might be worth logging.
     */
    properties: Record<string, unknown>;

    // Avoid exposing these publicly in a draft diagnostics GitHub issue, as doing so would allow us to correlate telemetry back to a user (i.e. it would become PII).
    corProjectId?: never;
    copilotSessionId?: never;
    copilotRequestId?: never;
}

/**
 * Aggregated diagnostics for a single Copilot on Rails project, pairing the request
 * that started it with the sequence of {@link DiagnosticEvent}s it produced.
 *
 * Like the events it contains, this metadata is never sent to telemetry or submitted
 * automatically — it should only be used to pre-populate a GitHub issue draft the user first reviews.
 */
export interface DiagnosticsMetadata {
    /**
     * The originating project prompt.
     */
    prompt: string;
    /**
     * Date first prompted, as an ISO 8601 string (`.toISOString()`).
     */
    createdAt: string;
    /**
     * The events recorded over a CoR workspace project's lifetime.
     */
    diagnosticEvents: DiagnosticEvent[];
}
