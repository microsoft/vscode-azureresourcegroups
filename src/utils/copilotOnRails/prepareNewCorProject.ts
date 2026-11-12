/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from "../../extensionVariables";
import { projectSubmissionState } from "../../tree/project/projectSubmissionState";
import { disableAutopilot } from "../../webviews/copilotOnRails/extension/autopilot";
import * as vscode from "vscode";
import { writeCorProjectMarker } from "./corProjectMarker";
import { recordCreatedAt, recordPrompt, recordSystemInfo } from "./diagnosticUtils";
import { COR_PROJECT_ID_KEY, getCorProjectId, getSystemInfo } from "./telemetryUtils";
import { COR_WORKFLOW_STATE_KEY } from "./workflowContext";

/**
 * Prepares a new Copilot on Rails project to be run in the current workspace
 * Must be called *before* any new-project state is recorded to wipe any cached data.
 */
export async function prepareNewCorProject(prompt: string): Promise<void> {
    await clearCorWorkspaceState();
    await disableAutopilot();
    projectSubmissionState.reset();

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('Create Project with Copilot requires an open workspace folder.');
    }
    await writeCorProjectMarker(workspaceFolder.uri, getCorProjectId());

    recordPrompt(prompt);
    recordCreatedAt();
    recordSystemInfo(getSystemInfo());
}

const corStateKeyPattern: RegExp = /copilotOnRails/i;
const preservedCorrelationKeys = new Set([COR_PROJECT_ID_KEY, COR_WORKFLOW_STATE_KEY]);

async function clearCorWorkspaceState(): Promise<void> {
    for (const key of ext.context.workspaceState.keys()) {
        if (corStateKeyPattern.test(key) && !preservedCorrelationKeys.has(key)) {
            await ext.context.workspaceState.update(key, undefined);
        }
    }
}
