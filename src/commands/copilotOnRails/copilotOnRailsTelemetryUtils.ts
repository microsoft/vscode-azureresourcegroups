/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ToolExecutionExtras } from "@microsoft/vscode-inproc-mcp";
import { v4 as uuidv4 } from "uuid";
import { ext } from "../../extensionVariables";

const projectIdKey: string = 'copilotOnRails.projectId';

/**
 * Returns the persistent project guid associated with the workspace project.
 * Automatically handles generating and caching one on first use.
 *
 * Note: The project guid is important for stitching together Copilot on Rails telemetry.
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
 * Sets the telemetry properties common to every Copilot on Rails tool execution.
 */
export function setCopilotOnRailsToolTelemetry(context: IActionContext, extras?: ToolExecutionExtras): void {
    context.telemetry.properties.isCopilotEvent = 'true';
    context.telemetry.properties.corProjectId = getCorProjectId();
    context.telemetry.properties.copilotSessionId = extras?.sessionId;
    context.telemetry.properties.copilotRequestId = extras?.requestId.toString();
}
