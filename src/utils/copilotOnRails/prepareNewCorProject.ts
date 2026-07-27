/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { clearDiagnosticEvents, recordCreatedAt, recordPrompt } from "./diagnosticUtils";
import { resetCorProjectId } from "./telemetryUtils";

/**
 * Prepares a new Copilot on Rails project to be run in the current workspace. Issues a new
 * `corProjectId` so telemetry isn't stitched to the previous attempt, records the
 * originating prompt, stamps the created-at time, and clears diagnostic events.
 */
export function prepareNewCorProject(prompt: string): void {
    resetCorProjectId();
    recordPrompt(prompt);
    recordCreatedAt();
    clearDiagnosticEvents();
}
