/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { IActionContext, parseError } from "@microsoft/vscode-azext-utils";
import { createReadStream } from "fs";
import { basename } from "path";
import { ProgressLocation, Uri, window, workspace } from "vscode";
import { ext } from "../extensionVariables";
import { localize } from "../utils/localize";
import { OSName, OSes, createCloudConsole, shells } from "./cloudConsole";


async function cloudConsole(os: OSName) {
    const shell = createCloudConsole(await ext.subscriptionProviderFactory(), os);
    if (shell) {
        void shell.terminal?.then(terminal => terminal.show());
        return shell;
    }

    return undefined;
}


export async function uploadFileToCloudShell(_context: IActionContext, uri?: Uri) {
    (async () => {
        if (!workspace.isTrusted) {
            throw new Error(localize('uploadingRequiresTrustedWorkspace', 'File upload only works in a trusted workspace.'));
        }
        let shell = shells[0];
        if (!shell) {
            const shellName = await window.showInformationMessage(localize('uploadingRequiresOpenCloudConsole', "File upload requires an open Cloud Shell."), OSes.Linux.shellName, OSes.Windows.shellName);
            if (!shellName) {
                return;
            }
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            shell = (await cloudConsole(shellName === OSes.Linux.shellName ? 'Linux' : 'Windows'))!;
        }
        if (!uri) {
            uri = (await window.showOpenDialog({}) || [])[0];
        }
        if (uri) {
            const filename = basename(uri.fsPath);
            return window.withProgress({
                location: ProgressLocation.Notification,
                title: localize('azure-account.uploading', "Uploading '{0}'...", filename),
                cancellable: true
            }, (progress, token) => {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                return shell.uploadFile(filename, createReadStream(uri!.fsPath), { progress, token });
            });
        }
    })().catch((error) => {
        ext.outputChannel.error(parseError(error).message);
    })
}
