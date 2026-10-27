/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getProjectPlanFiles, type ProjectPlanFilesWatcher } from './projectPlanFiles';
import { projectSubmissionState } from './projectSubmissionState';

/**
 * Watches for project plan files to appear, and clears the pending submission
 * state once they do. That state exists only to show progress in the gap between
 * the user submitting and the first file being written, so it's no longer needed
 * once the files are on disk.
 */
export function registerProjectSubmissionStateWatcher(context: vscode.ExtensionContext, planFilesWatcher: ProjectPlanFilesWatcher): void {
    const update = async (): Promise<void> => {
        const files = await getProjectPlanFiles();
        if (files.hasAny && files.currentStage >= projectSubmissionState.pendingStage) {
            projectSubmissionState.reset();
        }
    };

    context.subscriptions.push(planFilesWatcher.onDidChange(() => void update()));

    void update();
}
