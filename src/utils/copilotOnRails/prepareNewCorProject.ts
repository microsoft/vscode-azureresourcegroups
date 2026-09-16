/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from "../../extensionVariables";
import { projectSubmissionState } from "../../tree/project/projectSubmissionState";
import { disableAutopilot } from "../../webviews/copilotOnRails/extension/autopilot";
import { recordCreatedAt, recordPrompt, recordSystemInfo } from "./diagnosticUtils";
import { getSystemInfo } from "./telemetryUtils";

/**
 * Prepares a new Copilot on Rails project to be run in the current workspace
 * Must be called *before* any new-project state is recorded to wipe any cached data.
 */
export async function prepareNewCorProject(prompt: string): Promise<void> {
    await clearCorWorkspaceState();
    await disableAutopilot();
    projectSubmissionState.reset();

    recordPrompt(prompt);
    recordCreatedAt();
    recordSystemInfo(getSystemInfo());
}

const corStateKeyPattern: RegExp = /copilotOnRails/i;

async function clearCorWorkspaceState(): Promise<void> {
    for (const key of ext.context.workspaceState.keys()) {
        if (corStateKeyPattern.test(key)) {
            await ext.context.workspaceState.update(key, undefined);
        }
    }
}
