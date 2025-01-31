/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';

const GitHubCopilotForAzureExtensionId = 'ms-azuretools.vscode-azure-github-copilot';

export function registerChatStandInParticipantIfNeeded(context: vscode.ExtensionContext): void {
    const ghcp4aInstalled = vscode.extensions.getExtension(GitHubCopilotForAzureExtensionId) !== undefined;
    const disableChatStandIn = vscode.workspace.getConfiguration('azureResourceGroups').get<boolean | undefined>('disableChatStandIn');

    if (ghcp4aInstalled || // If the GitHub Copilot for Azure extension is already installed, don't register the chat participant
        disableChatStandIn === true) { // If the user has disabled chat standin by any means, don't register the chat participant
        return;
    }

    const chatStandInParticipant = vscode.chat.createChatParticipant(
        'ms-azuretools.azure-agent',
        (cr, cc, rs, t) => callWithTelemetryAndErrorHandling('azureResources.chatStandIn', ac => chatStandIn(ac, cr, cc, rs, t))
    );
    chatStandInParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'GitHubCopilotforAzure.svg');

    context.subscriptions.push(chatStandInParticipant);
}

async function chatStandIn(
    _actionContext: IActionContext,
    _request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    responseStream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken
): Promise<void> {
    responseStream.markdown(vscode.l10n.t('I can help with that. First, you need to install the GitHub Copilot for Azure extension.'));
    responseStream.button({
        title: vscode.l10n.t('Install GitHub Copilot for Azure'),
        command: 'workbench.extensions.installExtension',
        arguments: [GitHubCopilotForAzureExtensionId],
    });

    responseStream.markdown(vscode.l10n.t('Next, you need to restart Visual Studio Code.'));
    responseStream.button({
        title: vscode.l10n.t('Restart Visual Studio Code'),
        command: 'workbench.action.reloadWindow',
    });

    responseStream.markdown(vscode.l10n.t('Finally, please repeat your question.'));
}
