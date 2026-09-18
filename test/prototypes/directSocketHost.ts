/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { writeFile } from 'fs/promises';
import { join } from 'path';
import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const extension = vscode.extensions.getExtension('ms-azuretools.vscode-azureresourcegroups');
    if (!extension) { throw new Error('Prototype development extension was not loaded.'); }
    await extension.activate();
    const data = process.env.COR_MCP_PROTOTYPE_DATA;
    if (!data) { throw new Error('Missing isolated prototype data directory.'); }
    const capture = async () => {
        const diagnostics = await vscode.commands.executeCommand('copilotOnRails.prototype1.diagnostics');
        await writeFile(join(data, 'activation.json'), JSON.stringify(diagnostics, null, 2), { mode: 0o600 });
    };
    context.subscriptions.push(vscode.commands.registerCommand('corPrototype1.captureDiagnostics', capture));
    await capture();
    await vscode.commands.executeCommand('workbench.action.chat.open');
}
