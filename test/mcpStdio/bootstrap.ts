/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { run } from './extension';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const directory = process.env.AZURE_RESOURCES_MCP_ARTIFACTS;
    if (!directory) {
        throw new Error('Prototype companion requires its artifact directory.');
    }
    try {
        await run();
        const nextSteps = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.label === 'Next steps');
        await vscode.window.tabGroups.close(nextSteps);
        await vscode.commands.executeCommand('workbench.action.chat.open');
    } catch (error) {
        await writeFile(join(directory, 'extension-failure.txt'), error instanceof Error ? error.message : 'Extension check failed.');
    }
    const capture = async (): Promise<void> => {
        const status = await vscode.commands.executeCommand('copilotOnRails.mcpStdioPrototypeStatus');
        await writeFile(join(directory, 'provider-state.json'), JSON.stringify(status, undefined, 2));
    };
    await capture();
    const timer = setInterval(() => {
        void capture().catch(() => { console.error('Prototype status capture failed.'); });
    }, 1000);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
}
