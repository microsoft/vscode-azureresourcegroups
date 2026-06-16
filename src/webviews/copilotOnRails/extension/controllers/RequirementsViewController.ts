/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureAgentInstructions } from "../../../../commands/copilotOnRails/agentInstructions";
import { ext } from "../../../../extensionVariables";
import { type RequirementsData } from "../../views/utils/parseRequirements";
import { AUTOPILOT_QUERY_MARKER, enableAutopilot } from "../autopilot";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { markRequirementsSubmitted } from "../openRequirementsView";

interface SubmitMessage {
    command: 'submitRequirements';
    data: RequirementsData;
}

interface ReadyMessage {
    command: 'ready';
}

type IncomingMessage = SubmitMessage | ReadyMessage;

export class RequirementsViewController extends WebviewController<Record<string, never>> {
    private sourceFileUri: vscode.Uri | undefined;

    constructor(initialData: RequirementsData, sourceFileUri?: vscode.Uri) {
        super(ext.context, 'Project Requirements', 'requirementsView', {}, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.sourceFileUri = sourceFileUri;

        this.panel.webview.onDidReceiveMessage((message: IncomingMessage) => {
            switch (message.command) {
                case 'ready':
                    void this.panel.webview.postMessage({ command: 'setRequirementsData', data: initialData });
                    break;
                case 'submitRequirements':
                    void this.handleSubmit(message.data);
                    break;
            }
        });
    }

    updateData(data: RequirementsData, sourceFileUri?: vscode.Uri): void {
        if (sourceFileUri) {
            this.sourceFileUri = sourceFileUri;
        }
        void this.panel.webview.postMessage({ command: 'setRequirementsData', data });
    }

    private async handleSubmit(data: RequirementsData): Promise<void> {
        if (!this.sourceFileUri) {
            void this.panel.webview.postMessage({
                command: 'submitError',
                error: vscode.l10n.t('The requirements file location is unknown, so the answers could not be saved.'),
            });
            return;
        }

        try {
            const serialized = JSON.stringify({ ...data, parseError: undefined }, null, 2) + '\n';
            markRequirementsSubmitted(this.sourceFileUri, serialized);
            await vscode.workspace.fs.writeFile(this.sourceFileUri, Buffer.from(serialized, 'utf-8'));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            void this.panel.webview.postMessage({ command: 'submitError', error: message });
            return;
        }

        void this.panel.webview.postMessage({ command: 'submitComplete' });

        // Decide whether to run unattended (autopilot/"YOLO") or guided. Autopilot
        // requires an explicit modal confirmation because it enables global
        // auto-approval of chat tool actions for the duration of the run.
        let autopilot = false;
        if (data.executionMode === 'auto') {
            const enable = vscode.l10n.t('Enable Autopilot');
            const choice = await vscode.window.showWarningMessage(
                vscode.l10n.t('Run this project end-to-end in Autopilot mode?'),
                {
                    modal: true,
                    detail: vscode.l10n.t('Autopilot will plan, scaffold, and set up local debugging without stopping for approvals. While it runs, all chat tool actions (including file edits and terminal commands) are auto-approved globally. You can turn this off any time from the status bar.'),
                },
                enable,
            );
            autopilot = choice === enable;
            if (autopilot) {
                await enableAutopilot(ext.context);
            }
        }

        const relativePath = vscode.workspace.asRelativePath(this.sourceFileUri);
        if (await ensureAgentInstructions('azure-project-plan')) {
            const baseQuery = vscode.l10n.t('Requirements submitted at {0} — read the file and continue generating .azure/project-plan.md.', relativePath);
            const query = autopilot ? `${AUTOPILOT_QUERY_MARKER} ${baseQuery}` : baseQuery;
            try {
                await vscode.commands.executeCommand('workbench.action.chat.open', {
                    mode: 'azure-project-plan',
                    query,
                });
            } catch {
                // Chat may not be available; saving still succeeded.
            }
        }

        this.panel.dispose();
    }
}
