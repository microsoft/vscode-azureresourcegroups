/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from "@microsoft/vscode-azext-utils";
import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ensureAgentInstructions } from "../../../../commands/copilotOnRails/agentInstructions";
import { launchAgentChat } from "../../../../commands/copilotOnRails/openChatWithAgent";
import { azureProjectPlanAgent } from "../../../../constants";
import { ext } from "../../../../extensionVariables";
import { CopilotOnRailsContext } from "../../../../utils/copilotOnRails/CopilotOnRailsContext";
import { callWithDiagnosticsAndTelemetryHandling, setCorProp } from "../../../../utils/copilotOnRails/telemetryUtils";
import { type RequirementsData, type RequirementsExecutionMode } from "../../views/utils/parseRequirements";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { openLoadingView } from "../openLoadingView";
import { markRequirementsSubmitted } from "../openRequirementsView";
import { suppressTrackedViewCloseOnce } from "../projectSession";
import { getRequirementsTelemetry, REQUIREMENTS_TELEMETRY_PREFIX } from "../utils/requirementsTelemetryUtils";

interface SubmitMessage {
    command: 'submitRequirements';
    data: RequirementsData;
}

interface ReadyMessage {
    command: 'ready';
}

type IncomingMessage = SubmitMessage | ReadyMessage;

/** Telemetry property key recording whether agent instructions were successfully ensured. */
const ENSURE_AGENT_INSTRUCTIONS_KEY = 'ensureAgentInstructions';

export class RequirementsViewController extends WebviewController<Record<string, never>> {
    private sourceFileUri: vscode.Uri | undefined;
    private requirementsData: RequirementsData;

    constructor(initialData: RequirementsData, sourceFileUri?: vscode.Uri) {
        super(ext.context, 'Project Requirements', 'requirementsView', {}, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.sourceFileUri = sourceFileUri;
        this.requirementsData = initialData;

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
        this.requirementsData = data;
        void this.panel.webview.postMessage({ command: 'setRequirementsData', data });
    }

    private async handleSubmit(data: RequirementsData): Promise<void> {
        return await callWithTelemetryAndErrorHandling('copilotOnRails.submitRequirements', async (actionContext: IActionContext) => {
            return await callWithDiagnosticsAndTelemetryHandling(actionContext, { type: 'webviewAction', name: 'submitRequirements' }, async (context: CopilotOnRailsContext) => {
                this.requirementsData = data;
                this.recordRequirementsTelemetry(context);

                if (!this.sourceFileUri) {
                    setCorProp(context, 'submissionOutcome', 'noSourceFile');
                    void this.panel.webview.postMessage({
                        command: 'submitError',
                        error: vscode.l10n.t('The requirements file location is unknown, so the answers could not be saved.'),
                    });
                    return;
                }

                // Autopilot is chosen on the plan page so requirements start in guided until then.
                const executionMode: RequirementsExecutionMode = 'guided';

                try {
                    const serialized = JSON.stringify({ ...data, executionMode, parseError: undefined }, null, 2) + '\n';
                    markRequirementsSubmitted(this.sourceFileUri, serialized);
                    await vscode.workspace.fs.writeFile(this.sourceFileUri, Buffer.from(serialized, 'utf-8'));
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    setCorProp(context, 'submissionOutcome', 'writeFailed');
                    void this.panel.webview.postMessage({ command: 'submitError', error: message });
                    return;
                }

                void this.panel.webview.postMessage({ command: 'submitComplete' });

                const relativePath = vscode.workspace.asRelativePath(this.sourceFileUri);
                if (!(await ensureAgentInstructions('azure-project-plan'))) {
                    setCorProp(context, ENSURE_AGENT_INSTRUCTIONS_KEY, false);
                    setCorProp(context, 'submissionOutcome', 'agentInstructionsMissing');
                    return;
                }
                setCorProp(context, ENSURE_AGENT_INSTRUCTIONS_KEY, true);

                const query = vscode.l10n.t('Requirements submitted at {0} \u2014 read the file and continue generating .azure/project-plan.md.', relativePath);
                if (!(await launchAgentChat(azureProjectPlanAgent, query))) {
                    setCorProp(context, 'submissionOutcome', 'launchFailed');
                    return;
                }

                setCorProp(context, 'submissionOutcome', 'submitted');
                // Programmatic hand-off to the plan phase \u2014 don't treat this close as the user abandoning the flow.
                suppressTrackedViewCloseOnce();
                this.panel.dispose();
                openLoadingView({
                    stage: 0,
                    title: vscode.l10n.t('Generating your project plan\u2026'),
                    message: vscode.l10n.t('Copilot is using your answers to build .azure/project-plan.md. The plan view will open automatically when it\u2019s ready.'), showNeedHelp: true,
                });
            });
        });
    }

    private recordRequirementsTelemetry(context: CopilotOnRailsContext): void {
        try {
            const telemetry = getRequirementsTelemetry(this.requirementsData);
            for (const [key, value] of Object.entries(telemetry)) {
                setCorProp(context, `${REQUIREMENTS_TELEMETRY_PREFIX}${key}`, value);
            }
        } catch {
            // Telemetry extraction must never block the submission flow; swallow any parsing errors.
            setCorProp(context, `${REQUIREMENTS_TELEMETRY_PREFIX}parseFailed`, true);
        }
    }
}
