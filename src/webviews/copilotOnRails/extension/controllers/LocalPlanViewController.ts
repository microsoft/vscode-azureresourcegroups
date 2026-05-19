/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ext } from "../../../../extensionVariables";
import { type LocalPlanData } from "../../views/utils/parseLocalPlanMarkdown";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";

export class LocalPlanViewController extends WebviewController<Record<string, never>> {
    private sourceFileUri: vscode.Uri | undefined;

    constructor(planData: LocalPlanData, sourceFileUri?: vscode.Uri) {
        super(ext.context, 'Local Dev Plan', 'localPlanView', {}, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.sourceFileUri = sourceFileUri;

        this.panel.webview.onDidReceiveMessage((message: { command: string; data?: LocalPlanData; prompt?: string; originalCode?: string; newCode?: string; language?: string }) => {
            switch (message.command) {
                case 'ready':
                    void this.panel.webview.postMessage({ command: 'setLocalPlanData', data: planData });
                    break;
                case 'approvePlan':
                    void vscode.commands.executeCommand('azureProjectCreation.completeStep', 'projectCreation/localDevelopment/defineLocalPlan');
                    void vscode.commands.executeCommand('workbench.action.chat.open', {
                        mode: 'agent',
                        query: 'I approve the local dev plan.',
                    });
                    this.panel.dispose();
                    break;
                case 'submitPlanFeedback': {
                    const query = message.prompt?.trim();
                    if (!query) {
                        return;
                    }
                    void vscode.commands.executeCommand('workbench.action.chat.open', {
                        mode: 'agent',
                        query,
                    });
                    void this.panel.webview.postMessage({ command: 'revisionInProgress' });
                    break;
                }
                case 'openSourceFile':
                    this.openSourceFile();
                    break;
                case 'updateCodeBlock':
                    void this.updateCodeBlock(message.originalCode, message.newCode);
                    break;
            }
        });
    }

    updatePlanData(planData: LocalPlanData, sourceFileUri?: vscode.Uri): void {
        if (sourceFileUri) {
            this.sourceFileUri = sourceFileUri;
        }
        void this.panel.webview.postMessage({ command: 'setLocalPlanData', data: planData });
        void this.panel.webview.postMessage({ command: 'revisionComplete' });
    }

    private openSourceFile(): void {
        if (!this.sourceFileUri) {
            void vscode.window.showWarningMessage(
                vscode.l10n.t('The plan file location is unknown. Locate it manually in the workspace.'),
            );
            return;
        }
        void vscode.commands.executeCommand('vscode.open', this.sourceFileUri);
    }

    private async updateCodeBlock(originalCode: string | undefined, newCode: string | undefined): Promise<void> {
        if (typeof originalCode !== 'string' || typeof newCode !== 'string') {
            void this.panel.webview.postMessage({ command: 'codeBlockUpdateError', error: vscode.l10n.t('Invalid edit payload.') });
            return;
        }
        if (originalCode === newCode) {
            return;
        }
        if (!this.sourceFileUri) {
            void this.panel.webview.postMessage({ command: 'codeBlockUpdateError', error: vscode.l10n.t('The plan file location is unknown, so the change could not be saved.') });
            return;
        }

        try {
            const raw = Buffer.from(await vscode.workspace.fs.readFile(this.sourceFileUri)).toString('utf-8');
            const usesCRLF = raw.includes('\r\n');
            const normalized = raw.replace(/\r\n/g, '\n');

            const firstIdx = normalized.indexOf(originalCode);
            if (firstIdx === -1) {
                void this.panel.webview.postMessage({ command: 'codeBlockUpdateError', error: vscode.l10n.t("Couldn't locate the original block in the plan file. It may have changed.") });
                return;
            }
            if (normalized.indexOf(originalCode, firstIdx + 1) !== -1) {
                void this.panel.webview.postMessage({ command: 'codeBlockUpdateError', error: vscode.l10n.t('The original block appears more than once in the plan file. Edit the file directly to resolve the ambiguity.') });
                return;
            }

            const updated = normalized.slice(0, firstIdx) + newCode + normalized.slice(firstIdx + originalCode.length);
            const finalContent = usesCRLF ? updated.replace(/\n/g, '\r\n') : updated;
            await vscode.workspace.fs.writeFile(this.sourceFileUri, Buffer.from(finalContent, 'utf-8'));
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            void this.panel.webview.postMessage({
                command: 'codeBlockUpdateError',
                error: vscode.l10n.t('Saving the change failed: {0}', errorMessage),
            });
        }
    }
}
