/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands } from 'vscode';

export async function openChatWithAgent(agentName: string, prompt: string): Promise<void> {
    await commands.executeCommand('workbench.action.chat.open', {
        mode: agentName,
        query: prompt,
    });
}
