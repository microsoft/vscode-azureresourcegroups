/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext } from "@microsoft/vscode-azext-utils";
import { ExtensionContext, window } from "vscode";
import { localize } from "./utils/localize";

const REMIND_LATER_KEY = 'gchp/remindLater';
const DONT_SHOW_KEY = 'ghcp/dontShow';
const LAST_SESSION_DATE_KEY = 'ghcp/lastSessionDate';

export function ghcpToast({ globalState }: ExtensionContext): void {
    void callWithTelemetryAndErrorHandling('ghcpToast', async (context: IActionContext) => {
        // Todo: Check if list of extensions is installed, if not, return early
        // Need: Exact list of extension IDs to check

        const dontShow: boolean = globalState.get<boolean>(DONT_SHOW_KEY, false);
        const remindLater: boolean = globalState.get<boolean>(REMIND_LATER_KEY, false);
        const lastSessionDate: string = globalState.get<string>(LAST_SESSION_DATE_KEY, new Date(0).toDateString());

        // Question: How long should we wait if the user chooses "Remind me later"?
        const now: string = new Date().toDateString();
        if (
            dontShow ||
            remindLater && lastSessionDate === now
        ) {
            return;
        }

        await globalState.update(REMIND_LATER_KEY, false);

        const install = {
            title: localize('azureResourceGroups.Install', 'Install'),
            run: async () => {
                context.telemetry.properties.install = 'true';
                // Todo: Issue install command
                // Need: New GHCP4A extension ID
            },
        };

        const remind = {
            title: localize('azureResourceGroups.remindLater', "Remind Me Later"),
            run: async () => {
                context.telemetry.properties.remindMeLater = 'true';
                await globalState.update(REMIND_LATER_KEY, true);
            },
        };

        const never = {
            title: localize('azureResourceGroups.neverAgain', "Don't Show Again"),
            run: async () => {
                context.telemetry.properties.dontShowAgain = 'true';
                await globalState.update(DONT_SHOW_KEY, true);
            }
        };

        const message: string = localize('ghcpToastMessage', 'Get help with Azure questions and tasks in Copilot Chat by installing the GitHub Copilot for Azure extension.');
        const button = await window.showInformationMessage(message, install, remind, never);

        context.telemetry.properties.userAsked = 'true';
        await button?.run();
    });
}
