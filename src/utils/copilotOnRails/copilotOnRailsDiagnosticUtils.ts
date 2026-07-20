/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { maskUserInfo, parseError } from "@microsoft/vscode-azext-utils";
import { ext } from "../../extensionVariables";
import { CopilotOnRailsContext, ensureRequiredCopilotOnRailsContext } from "./CopilotOnRailsContext";

const maxCachedEvents: number = 50;
const eventsKey: string = 'copilotOnRails.logs';

/**
 * Property key under which each event's ISO 8601 record time is stored inside
 * {@link DiagnosticEvent.properties}. Kept as a shared constant so the recorder
 * and any duration calculations agree on the name.
 */
export const eventTimestampProperty = 'eventTimestamp';

/**
 * Appends a new immutable event to the cache, stamping it with the current time and
 * trimming to the most recent {@link maxCachedEvents}.
 *
 * The record time is written into {@link DiagnosticEvent.properties} under
 * {@link eventTimestampProperty} (stamped last so it always reflects when the
 * entry was recorded, not any caller-supplied value).
 */
export function recordDiagnosticEvent(event: DiagnosticEvent): void {
    const entry: DiagnosticEvent = { ...event, properties: { ...event.properties, [eventTimestampProperty]: new Date().toISOString() } };
    const events: DiagnosticEvent[] = getDiagnosticEvents();
    events.push(entry);
    void ext.context.workspaceState.update(eventsKey, events.slice(-maxCachedEvents));
}

export function getDiagnosticEvents(): DiagnosticEvent[] {
    return ext.context.workspaceState.get<DiagnosticEvent[]>(eventsKey, []);
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

/**
 * A discrete, immutable entry describing a single action taken during the Copilot
 * on Rails journey. Entries are append-only and never updated after being written,
 * so the {@link eventTimestampProperty} value in {@link properties} fully captures
 * when the event happened.
 *
 * Note: These entries are never sent to telemetry and are never submitted anywhere
 * on the user's behalf. They are workspace-cached and only used to pre-populate a
 * GitHub issue draft that the user reviews and can edit before choosing to submit.
 */
export interface DiagnosticEvent {
    /**
     * The name of the tool or command that produced the event.
     */
    name: string;
    /**
     * The tool or command that produced the event.
     */
    type: 'extensionCommand' | 'mcpTool';
    /**
     * Which point in the tool's lifecycle this entry represents.
     */
    status?: 'start' | 'success' | 'error';
    /**
     * A catch-all for any other properties that might be worth logging. Includes
     * {@link eventTimestampProperty} (the ISO 8601 record time) stamped by
     * {@link recordDiagnosticEvent}.
     */
    properties: Record<string, unknown>;

    // Avoid exposing these publically in a draft diagnostics GitHub issue, as doing so would allow us to correlate telemetry back to a user (i.e. it would become PII).
    corProjectId?: never;
    copilotSessionId?: never;
    copilotRequestId?: never;
}
