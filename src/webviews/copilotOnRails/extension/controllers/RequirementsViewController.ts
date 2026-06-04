/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ext } from "../../../../extensionVariables";
import { type RequirementsData } from "../../views/utils/parseRequirements";
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
            const { parseError, ...rest } = data;
            void parseError;
            const serialized = JSON.stringify(rest, null, 2) + '\n';
            markRequirementsSubmitted(this.sourceFileUri);
            await vscode.workspace.fs.writeFile(this.sourceFileUri, Buffer.from(serialized, 'utf-8'));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            void this.panel.webview.postMessage({ command: 'submitError', error: message });
            return;
        }

        void this.panel.webview.postMessage({ command: 'submitComplete' });

        try {
            await vscode.commands.executeCommand('workbench.action.chat.open', {
                mode: 'azure-project-plan',
                query: 'Requirements submitted at .azure/requirements.json — read the file and continue generating .azure/project-plan.md.',
            });
        } catch {
            // Chat may not be available; saving still succeeded.
        }

        this.panel.dispose();
    }
}
