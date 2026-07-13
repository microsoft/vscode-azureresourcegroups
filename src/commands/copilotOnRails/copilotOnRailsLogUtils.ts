/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from "../../extensionVariables";

const maxCachedLogs: number = 50;
const logsKey: string = 'copilotOnRails.logs';

export function addCorLog(log: CopilotOnRailsLog): void {
    const logs: CopilotOnRailsLog[] = getCorLogs();
    logs.push(log);
    void ext.context.workspaceState.update(logsKey, logs.slice(-maxCachedLogs));
}

export function getCorLogs(): CopilotOnRailsLog[] {
    return ext.context.workspaceState.get<CopilotOnRailsLog[]>(logsKey, []);
}

/**
 * A discrete, immutable entry describing a single action taken during the Copilot
 * on Rails journey. Entries are append-only and never updated after being written,
 * so a single {@link timestamp} fully captures when the event happened.
 *
 * Note: These entries are never sent to telemetry and are never submitted anywhere
 * on the user's behalf. They are workspace-cached and only used to pre-populate a
 * GitHub issue draft that the user reviews and can edit before choosing to submit.
 */
export interface CopilotOnRailsLog {
    /**
     * When the event occurred, as an ISO 8601 string (`.toISOString()`).
     */
    timestamp: string;
    /**
     * The tool or command that produced the event.
     */
    type: 'extensionCommand' | 'mcpTool';
    /**
     * Which point in the tool's lifecycle this entry represents.
     */
    status?: 'start' | 'success' | 'error';
    /**
     * A catch-all for any other properties that might be worth logging.
     */
    properties: Record<string, unknown>;

    // Do not allow any of these...
    // Exposing these publically in a GitHub issue would allow us to correlate telemetry to a user (i.e. it would become PII)
    corProjectId: never;
    copilotSessionId: never;
    copilotRequestId: never;
}
