/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, maskUserInfo } from "@microsoft/vscode-azext-utils";
import { ToolExecutionExtras } from "@microsoft/vscode-inproc-mcp";
import * as os from "os";
import { v4 as uuidv4 } from "uuid";
import * as vscode from "vscode";
import { ext } from "../../extensionVariables";
import { isAutopilotActive } from "../../webviews/copilotOnRails/extension/autopilot";
import { readSessionState } from "../../webviews/copilotOnRails/extension/projectSession";
import { settingUtils } from "../settingUtils";
import { CopilotOnRailsContext, ensureRequiredCopilotOnRailsContext } from "./CopilotOnRailsContext";
import { DiagnosticEvent, withDiagnosticEvents } from "./diagnosticUtils";

/**
 * Builds a standardized Copilot on Rails identifier for command ids and telemetry.
 * The id will always be prefixed with `copilotOnRails.`.
 */
export function corId(name: string): string {
    return `copilotOnRails.${name}`;
}

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

    // Intentionally telemetry only since this data was already cached on the worspace level for diagnostics
    for (const [key, value] of Object.entries(getSystemInfo())) {
        context.telemetry.properties[key] = value;
    }

    const copilotModel: string | undefined = readSessionState()?.model;
    if (copilotModel) {
        setCorProp(corContext, 'copilotModel', copilotModel);
    }

    setCorProp(corContext, 'autopilot', isAutopilotActive());

    // Record the current approval posture so every command/tool event captures
    // whether chat actions are auto-approved. Reads the same settings autopilot
    // toggles (see autopilot.ts): the global chat auto-approve setting and the
    // default chat permission level.
    const approvalsAutoApprove: unknown = settingUtils.getGlobalSetting<unknown>('autoApprove', 'chat.tools.global');
    const approvalsPermissionLevel: unknown = vscode.workspace.getConfiguration('chat.permissions').inspect('default')?.globalValue;
    setCorProp(corContext, 'approvalsAutoApprove', approvalsAutoApprove);
    setCorProp(corContext, 'approvalsPermissionLevel', approvalsPermissionLevel);

    return await withDiagnosticEvents(corContext, { type: eventDetails.type, name: eventDetails.name }, async () => await command(corContext));
}

export function getSystemInfo(): Record<string, string> {
    const systemInfo: Record<string, string> = {
        osPlatform: os.platform(),
        osRelease: os.release(),
        osArch: os.arch(),
        nodeVersion: process.versions.node,
        vscodeVersion: vscode.version,
    };

    const cpuModel: string | undefined = os.cpus()[0]?.model;
    if (cpuModel) {
        systemInfo.cpuModel = cpuModel;
    }

    return systemInfo;
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
 * Call this automatically handle setting both the diagnostics and telemetry error message.
 */
export function setCorErrorProp(context: CopilotOnRailsContext, key: string, errorMessage: string): void {
    const maskedMessage = maskUserInfo(errorMessage, context.valuesToMask);
    ensureRequiredCopilotOnRailsContext(context).diagnostics.properties[key] = maskedMessage;
    context.telemetry.properties[key] = maskedMessage;
}
