/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { commands, extensions } from "vscode";

export async function installExtension(context: IActionContext, extensionId: string): Promise<void> {
    context.telemetry.properties.extensionId = extensionId;
    await commands.executeCommand('extension.open', extensionId);

    function isInstalled(): boolean {
        return !!extensions.getExtension(extensionId);
    }

    const alreadyInstalled = isInstalled();
    context.telemetry.properties.alreadyInstalled = String(alreadyInstalled);

    if (!alreadyInstalled) {
        context.telemetry.properties.installedAfterOneMinute = 'false';
        return new Promise((resolve) => {
            const disposable = extensions.onDidChange(() => {
                if (isInstalled()) {
                    context.telemetry.properties.installedAfterOneMinute = 'true';
                    disposable.dispose();
                    clearTimeout(timeout);
                    resolve();
                    void extensions.getExtension(extensionId)?.activate();
                }
            });

            // Listen for extension change events for 1 minute at most.
            // If VS Code is closed before this timeout, the event for this command isn't sent.
            const timeout = setTimeout(() => {
                disposable.dispose();
                resolve();
            }, 1000 * 60 * 1 /* 1 minute */);
        });
    }
}
