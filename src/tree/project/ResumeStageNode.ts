/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { copilotOnRailsCommandIds } from '../../webviews/copilotOnRails/extension/copilotOnRailsCommands';
import { ActionNode } from './ActionNode';

/**
 * Child action node shown under the current stage when an interrupted
 * create-with-copilot run is detected. Invokes the resume command so the user
 * is dropped back into the correct phase without browsing chat history.
 */
export class ResumeStageNode extends ActionNode {
    constructor(
        stageId: string,
        /** Human-readable label of the phase being resumed, shown as the node description. */
        resumeLabel?: string,
    ) {
        super({
            stageId,
            idSuffix: 'resume',
            label: vscode.l10n.t('Resume'),
            icon: 'debug-continue',
            description: resumeLabel,
            tooltip: resumeLabel
                ? vscode.l10n.t('Resume “{0}” where you left off', resumeLabel)
                : vscode.l10n.t('Resume this step where you left off'),
            // Always route through the single resume entry point so the resolved
            // flow state (including phase-specific resume prompts/args) is applied,
            // rather than invoking a raw phase command with its default prompt.
            commandId: copilotOnRailsCommandIds.resumeProjectWithCopilot,
        });
    }
}
