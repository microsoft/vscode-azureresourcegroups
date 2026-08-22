/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { launchAgentAndRecordOutcome } from "../../../../commands/copilotOnRails/openChatWithAgent";
import { azureProjectPlanAgent } from "../../../../constants";
import { ext } from "../../../../extensionVariables";
import { projectSubmissionState } from "../../../../tree/project/projectSubmissionState";
import { CopilotOnRailsContext } from "../../../../utils/copilotOnRails/CopilotOnRailsContext";
import { prepareNewCorProject } from "../../../../utils/copilotOnRails/prepareNewCorProject";
import { callWithDiagnosticsAndTelemetryHandling, corId, setCorProp } from "../../../../utils/copilotOnRails/telemetryUtils";
import { type CreateProjectViewControllerType, type LoadingViewConfiguration } from "../../views/utils/viewConfigTypes";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { openLoadingView } from "../openLoadingView";
import { recordModel } from "../projectSession";
import { recordRecentPrompt } from "../recentPrompts";

export type { CreateProjectViewControllerType };

export class CreateProjectViewController extends WebviewController<CreateProjectViewControllerType> {
    constructor(viewConfig: CreateProjectViewControllerType) {
        super(ext.context, viewConfig.title, 'createProjectView', viewConfig, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.panel.webview.onDidReceiveMessage(
            (message: { command: string; prompt?: string; model?: string }) => {
                switch (message.command) {
                    case 'plan':
                        if (message.prompt) {
                            void this.planProject(message.prompt, message.model);
                        } else {
                            this.panel.dispose();
                        }
                        break;
                }
            }
        );
    }

    /**
     * Resets any leftover workspace state from a previous project before launching the
     * planning agent, so the two attempts don't get conflated.
     */
    private async planProject(prompt: string, model?: string): Promise<void> {
        await prepareNewCorProject(prompt);
        await this.openChatWithQuery(prompt, model);
    }

    private async openChatWithQuery(query: string, model?: string): Promise<void> {
        await callWithTelemetryAndErrorHandling(corId('createProjectSubmitPrompt'), async (actionContext: IActionContext) => {
            await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'createProjectSubmitPrompt' }, async (context: CopilotOnRailsContext) => {
                setCorProp(context, 'modelSelectedInView', !!model);
                if (model) {
                    await recordModel(model);
                }
                await recordRecentPrompt(query);

                const submissionOutcomeKey = 'submissionOutcome';
                const loading: LoadingViewConfiguration = {
                    stage: 0,
                    title: vscode.l10n.t('Gathering project requirements…'),
                    message: vscode.l10n.t('Copilot is analyzing your prompt and preparing the requirements questionnaire.'),
                    showNeedHelp: true,
                };

                if (await launchAgentAndRecordOutcome(context, submissionOutcomeKey, { agentName: azureProjectPlanAgent, prompt: query, loading, model, restoreCreateViewOnReload: true, onBeforeHandoff: () => this.panel.dispose() })) {
                    setCorProp(context, submissionOutcomeKey, 'submitted');
                    projectSubmissionState.setPending();
                    openLoadingView(loading);
                }
            });
        });
    }
}
