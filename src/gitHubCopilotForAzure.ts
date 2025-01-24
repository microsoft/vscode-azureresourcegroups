/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext, openUrl } from "@microsoft/vscode-azext-utils";
import { commands, Extension, ExtensionContext, extensions, window } from "vscode";
import { localize } from "./utils/localize";

const ghcpExtensionId = 'github.copilot';
const ghcpChatExtensionId = 'github.copilot-chat';
const ghcpfaExtensionId = 'ms-azuretools.vscode-azure-github-copilot';
const ghcpfaLearnPage = 'https://aka.ms/GetGitHubCopilotForAzure';
const dontShowKey = 'ghcpfa/dontShow';

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Conditionally show an install toast for the GitHub Copilot for Azure extension
 */
export function gitHubCopilotForAzureToast({ globalState }: ExtensionContext): void {
    void callWithTelemetryAndErrorHandling('ghcpfaToast', async (context: IActionContext) => {
        await delay(10 * 1000); // Wait 10 seconds to show toast. This gives time for the extension to install.
        context.telemetry.properties.isActivationEvent = 'true';

        const arePrecursorExtensionsInstalled: boolean = isExtensionInstalled(ghcpExtensionId) && isExtensionInstalled(ghcpChatExtensionId);
        if (!arePrecursorExtensionsInstalled || isExtensionInstalled(ghcpfaExtensionId)) {
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
                await commands.executeCommand('extension.open', ghcpfaExtensionId);
                await commands.executeCommand('workbench.extensions.installExtension', ghcpfaExtensionId);
            },
        };

        const learnMore = {
            title: localize('learnMore', 'Learn More'),
            run: async () => {
                context.telemetry.properties.toastChoice = 'learnMore';
                await openUrl(ghcpfaLearnPage);
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
