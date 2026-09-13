/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { writeFile } from 'node:fs/promises';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const extension = vscode.extensions.getExtension('ms-azuretools.vscode-azureresourcegroups');
    if (!extension) {
        throw new Error('Azure Resources development extension is missing');
    }
    await extension.activate();
    if (process.env.AZURE_RESOURCES_MCP_HTTP_PROTOTYPE_VERIFY_HOST === '1') {
        if (!vscode.workspace.isTrusted) {
            void vscode.window.showInformationMessage('Trust only this empty prototype fixture to run the SDK extension-host check.');
            await new Promise<void>(resolve => {
                const subscription = vscode.workspace.onDidGrantWorkspaceTrust(() => {
                    subscription.dispose();
                    resolve();
                });
                context.subscriptions.push(subscription);
            });
        }
        const output = vscode.window.createOutputChannel('Azure HTTP Prototype Check', { log: true });
        context.subscriptions.push(output);
        const { run } = await import('../test/experimentalLoopback/extensionHost.js');
        const resultPath = process.env.AZURE_RESOURCES_MCP_HTTP_PROTOTYPE_RESULT;
        try {
            await run();
            if (resultPath) {
                await writeFile(resultPath, JSON.stringify({ passed: true }), { mode: 0o600 });
            }
            output.info('PASS: actual extension-host SDK check. Fixed command, Next steps tab, revocation and disposal. No Copilot model used.');
        } catch (error) {
            if (resultPath) {
                await writeFile(resultPath, JSON.stringify({ passed: false }), { mode: 0o600 });
            }
            output.error('SDK extension-host check failed. Inspect the Extension Host log.');
            throw error;
        }
    } else {
        void vscode.window.showInformationMessage('Azure Resources HTTP prototype is available. Run Azure: Enable MCP HTTP Prototype to approve this window.');
    }
}
