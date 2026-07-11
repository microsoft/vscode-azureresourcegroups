/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ToolExecutionExtras } from "@microsoft/vscode-inproc-mcp";
import { v4 as uuidv4 } from "uuid";
import { ext } from "../../../extensionVariables";

const corProjectIdKey: string = 'copilotOnRails.projectId';

/**
 * Sets the telemetry properties common to every Copilot on Rails tool execution.
 */
export function setCopilotOnRailsTelemetry(context: IActionContext, extras?: ToolExecutionExtras): void {
    let projectId: string | undefined = ext.context.workspaceState.get(corProjectIdKey);
    if (!projectId) {
        projectId = uuidv4();
        ext.context.workspaceState.update(corProjectIdKey, projectId);
    }

    context.telemetry.properties.isCopilotEvent = 'true';
    context.telemetry.properties.corProjectId = projectId;
    context.telemetry.properties.sessionId = extras?.sessionId;
    context.telemetry.properties.requestId = extras?.requestId.toString();
}
