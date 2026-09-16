/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { workspace, type Uri, type WorkspaceFolder } from "vscode";

export function getWorkspaceFolderUri(folderName: string): Uri {
    const workspaceFolders: readonly WorkspaceFolder[] | undefined = workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('No workspace is open');
    } else {
        for (const workspaceFolder of workspaceFolders) {
            if (workspaceFolder.name === folderName) {
                return workspaceFolder.uri;
            }
        }
    }

    throw new Error(`Unable to find workspace folder "${folderName}"`);
}
