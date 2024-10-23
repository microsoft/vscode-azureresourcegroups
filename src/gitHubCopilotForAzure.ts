/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext, openUrl } from "@microsoft/vscode-azext-utils";
import { commands, Extension, ExtensionContext, extensions, window } from "vscode";
import { localize } from "./utils/localize";

const ghcpExtensionId = 'github.copilot';
const ghcpChatExtensionId = 'github.copilot-chat';
const ghcp4aExtensionId = 'ms-azuretools.vscode-azure-github-copilot';
const ghcp4aLearnPage = 'https://aka.ms/GetGitHubCopilotForAzure';
const dontShowKey = 'ghcp4a/dontShow';

/**
 * Conditionally show an install toast for the GitHub Copilot for Azure extension
 */
export function gitHubCopilotForAzureToast({ globalState }: ExtensionContext): void {
    void callWithTelemetryAndErrorHandling('ghcp4aToast', async (context: IActionContext) => {
        context.telemetry.properties.isActivationEvent = 'true';

        const arePrecursorExtensionsInstalled: boolean = isExtensionInstalled(ghcpExtensionId) && isExtensionInstalled(ghcpChatExtensionId);
        if (!arePrecursorExtensionsInstalled || isExtensionInstalled(ghcp4aExtensionId)) {
            return;
        }

        const dontShow: boolean = globalState.get<boolean>(dontShowKey, false);
        if (dontShow) {
            return;
        }

        const install = {
            title: localize('install', 'Install'),
            run: async () => {
                context.telemetry.properties.toastChoice = 'install';
                await commands.executeCommand('extension.open', ghcp4aExtensionId);
                await commands.executeCommand('workbench.extensions.installExtension', ghcp4aExtensionId);
            },
        };

        const learnMore = {
            title: localize('learnMore', 'Learn More'),
            run: async () => {
                context.telemetry.properties.toastChoice = 'learnMore';
                await openUrl(ghcp4aLearnPage);
            },
        };

        const never = {
            title: localize('dontShowAgain', "Don't Show Again"),
            run: async () => {
                context.telemetry.properties.toastChoice = 'dontShowAgain';
                await globalState.update(dontShowKey, true);
            },
        };

        context.telemetry.properties.userAsked = 'true';

        const message: string = localize('ghcpToastMessage', 'Get help with Azure questions and tasks in Copilot Chat by installing the GitHub Copilot for Azure extension.');
        const button = await window.showInformationMessage(message, install, learnMore, never);
        await button?.run();
    });
}


function isExtensionInstalled(extensionId: string): boolean {
    const extension: Extension<unknown> | undefined = extensions.getExtension(extensionId);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return !!extension?.packageJSON?.version;
}
