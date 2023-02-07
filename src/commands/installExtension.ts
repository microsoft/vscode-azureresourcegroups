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
        return new Promise((resolve) => {
            const disposable = extensions.onDidChange(() => {
                const installed = isInstalled();
                context.telemetry.properties.installedAfter30s = String(isInstalled());

                if (installed) {
                    disposable.dispose();
                    clearTimeout(timeout);
                    resolve();
                }
            });

            const timeout = setTimeout(() => {
                context.telemetry.properties.installedAfter30s = 'false';
                disposable.dispose();
                resolve();
            }, 1000 * 30 /* 30 seconds */);
        });
    }
}
