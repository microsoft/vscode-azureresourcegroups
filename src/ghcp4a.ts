/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext, openUrl } from "@microsoft/vscode-azext-utils";
import { commands, Extension, ExtensionContext, extensions, window } from "vscode";
import { installExtension } from "./commands/installExtension";
import { localize } from "./utils/localize";

const ghcpExtensionId = 'github.copilot';
const ghcpChatExtensionId = 'github.copilot-chat';
const ghcp4aExtensionId = ''; // Todo: Populate this after the extension is published?
const ghcp4aInstallPageUrl = 'https://aka.ms/GetGitHubCopilotForAzure';
const dontShowKey = 'ghcp/dontShow';

export function ghcp4aInstallToast({ globalState }: ExtensionContext): void {
    void callWithTelemetryAndErrorHandling('ghcp4aInstallToast', async (context: IActionContext) => {
        const areCopilotExtensionsInstalled: boolean = isExtensionInstalled(ghcpExtensionId) && isExtensionInstalled(ghcpChatExtensionId);
        if (!areCopilotExtensionsInstalled || isExtensionInstalled(ghcp4aExtensionId)) {
            return;
        }

        const dontShow: boolean = globalState.get<boolean>(dontShowKey, false);
        if (dontShow) {
            return;
        }

        const install = {
            title: localize('install', 'Install'),
            run: async () => {
                context.telemetry.properties.install = 'true';
                await installExtension(context, ghcp4aExtensionId);
                await commands.executeCommand('extension.open', ghcp4aExtensionId);
            },
        };

        const learnMore = {
            title: localize('learnMore', 'learnMore'),
            run: async () => {
                context.telemetry.properties.learnMore = 'true';
                await openUrl(ghcp4aInstallPageUrl);
            },
        };

        const remind = {
            title: localize('remindLater', "Remind Me Later"),
            run: async () => {
                context.telemetry.properties.remindMeLater = 'true';
                // Do nothing. Should open again on next extension activation.
            },
        };

        const never = {
            title: localize('dontShowAgain', "Don't Show Again"),
            run: async () => {
                context.telemetry.properties.dontShowAgain = 'true';
                await globalState.update(dontShowKey, true);
            }
        };

        const message: string = localize('ghcpToastMessage', 'Get help with Azure questions and tasks in Copilot Chat by installing the GitHub Copilot for Azure extension.');
        const button = await window.showInformationMessage(message, install, learnMore, remind, never);

        context.telemetry.properties.userAsked = 'true';
        await button?.run();
    });
}


function isExtensionInstalled(extensionId: string): boolean {
    const extension: Extension<unknown> | undefined = extensions.getExtension(extensionId);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return !!extension?.packageJSON?.version;
}
