/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext, registerCommand } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { settingUtils } from '../utils/settingUtils';
import { askAgentAboutResourcePrompt } from './askAgentAboutResource';

const GitHubCopilotForAzureExtensionId = 'ms-azuretools.vscode-azure-github-copilot';

export function registerChatStandInParticipantIfNeeded(context: vscode.ExtensionContext): void {
    const ghcp4aInstalled = vscode.extensions.getExtension(GitHubCopilotForAzureExtensionId) !== undefined;
    const enableChatStandIn = vscode.workspace.getConfiguration('azureResourceGroups').get<boolean | undefined>('enableChatStandIn');

    if (ghcp4aInstalled || // If the GitHub Copilot for Azure extension is already installed, don't register the chat participant
        !enableChatStandIn) { // If the user has disabled chat standin by any means, don't register the chat participant
        return;
    }

    const chatStandInParticipant = vscode.chat.createChatParticipant(
        'ms-azuretools.azure-agent-stand-in',
        (cr, cc, rs, t) => callWithTelemetryAndErrorHandling('azureResources.chatStandIn', ac => chatStandIn(ac, cr, cc, rs, t))
    );
    chatStandInParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'GitHubCopilotforAzure.svg');

    context.subscriptions.push(chatStandInParticipant);
    registerCommand('azureResourcesGroups.installGitHubCopilotForAzureFromChat', installGitHubCopilotForAzureFromChat);
    registerCommand('azureResourceGroups.updateChatStandInSetting', updateChatStandInSetting);
}

async function chatStandIn(
    _actionContext: IActionContext,
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    responseStream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken
): Promise<void> {
    responseStream.markdown(vscode.l10n.t('I can help with that. First, you need to install the GitHub Copilot for Azure extension.'));
    responseStream.button({
        title: vscode.l10n.t('Install GitHub Copilot for Azure'),
        command: 'azureResourcesGroups.installGitHubCopilotForAzureFromChat',
    });

    const postButtonMessage = request.prompt === askAgentAboutResourcePrompt ? vscode.l10n.t(`After that, please use \`Ask @azure\` again.`) :
        vscode.l10n.t(`After that, please repeat your question.\n\n`);
    responseStream.markdown(postButtonMessage);

    responseStream.markdown(vscode.l10n.t('Or you can also disable this message by clicking the button below.'));

    responseStream.button({
        title: vscode.l10n.t(`Don't ask me again`),
        command: 'azureResourceGroups.updateChatStandInSetting'
    });
}

async function installGitHubCopilotForAzureFromChat(context: IActionContext): Promise<void> {
    try {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', GitHubCopilotForAzureExtensionId);
    } catch (error) {
        // Almost certainly the user cancelled the installation
        context.telemetry.properties.result = 'Canceled';
    }
}

async function updateChatStandInSetting(): Promise<void> {
    await settingUtils.updateGlobalSetting('enableChatStandIn', false);
}
