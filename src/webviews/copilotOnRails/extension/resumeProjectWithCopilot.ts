/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { type IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { copilotOnRailsCommandIds } from "./copilotOnRailsCommands";
import { resolveFlowState } from "./flowState";

/**
 * Single entry point for resuming an interrupted create-with-copilot run. Routes
 * to the correct phase command based on the resolved flow state, so the user
 * never has to find the right chat session manually. Falls back to starting a
 * new project when no flow is detected.
 */
export async function resumeProjectWithCopilot(context: IActionContext): Promise<void> {
    const flow = await resolveFlowState();
    if (!flow) {
        await vscode.commands.executeCommand(copilotOnRailsCommandIds.createProjectWithCopilot);
        return;
    }

    context.telemetry.properties.resumePhase = flow.phase;
    context.telemetry.properties.resumeStatus = flow.status;

    await vscode.commands.executeCommand(flow.resumeCommandId, ...(flow.resumeArgs ?? []));
}
