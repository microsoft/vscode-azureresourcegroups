/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, maskUserInfo } from "@microsoft/vscode-azext-utils";
import { ToolExecutionExtras } from "@microsoft/vscode-inproc-mcp";
import { v4 as uuidv4 } from "uuid";
import { ext } from "../../extensionVariables";
import { CopilotOnRailsContext, ensureRequiredCopilotOnRailsContext } from "./CopilotOnRailsContext";
import { DiagnosticEvent, withDiagnosticEvents } from "./diagnosticUtils";

const projectIdKey: string = 'copilotOnRails.projectId';

/**
 * Returns the persistent project guid associated with the workspace project.
 * Automatically handles generating and caching one on first use.
 *
 * Note: The project guid is important for stitching together the full chain of Copilot on Rails telemetry.
 */
export function getCorProjectId(): string {
    let projectId: string | undefined = ext.context.workspaceState.get(projectIdKey);
    if (!projectId) {
        projectId = uuidv4();
        void ext.context.workspaceState.update(projectIdKey, projectId);
    }
    return projectId;
}

/**
 * Prepares a {@link CopilotOnRailsContext} and runs a provided `command` inside the Copilot on Rails
 * diagnostic-event lifecycle. This is the single entrypoint-agnostic wrapper. Both the extension-command
 * registration and the MCP tools should call it, so the invoked command receives the same context
 * shape regardless of how it was reached.
 */
export async function callWithDiagnosticsAndTelemetryHandling<T>(
    context: IActionContext,
    eventDetails: { type: DiagnosticEvent['type']; name: string; extras?: ToolExecutionExtras },
    command: (context: CopilotOnRailsContext) => Promise<T>,
): Promise<T> {
    context.telemetry.properties.isCopilotEvent = 'true';
    context.telemetry.properties.corProjectId = getCorProjectId();

    if (eventDetails.extras) {
        context.telemetry.properties.copilotSessionId = eventDetails.extras.sessionId;
        context.telemetry.properties.copilotRequestId = eventDetails.extras.requestId.toString();
    }

    const corContext: CopilotOnRailsContext = ensureRequiredCopilotOnRailsContext(context);
    return await withDiagnosticEvents(corContext, { type: eventDetails.type, name: eventDetails.name }, async () => await command(corContext));
}

/**
 * Call this to set both the diagnostics and telemetry properties.
 *
 * **Important**: Don't call this if combining the two properties could result in a leak of PII (e.g. corProjectId, copilotSessionId, copilotRequestId, etc.)
 */
export function setCorProp(context: CopilotOnRailsContext, key: string, value: unknown): void {
    ensureRequiredCopilotOnRailsContext(context).diagnostics.properties[key] = value;
    context.telemetry.properties[key] = String(value);
}

/**
 * Call this to set both the diagnostics and telemetry properties.
 */
export function setCorErrorProp(context: CopilotOnRailsContext, key: string, errorMessage: string): void {
    ensureRequiredCopilotOnRailsContext(context).diagnostics.properties[key] = errorMessage;
    context.telemetry.properties[key] = maskUserInfo(errorMessage, context.valuesToMask);
}
