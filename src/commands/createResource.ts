/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import { Command, commands, extensions } from 'vscode';
import { SubscriptionTreeItem } from '../tree/SubscriptionTreeItem';

export async function createResource(_context: IActionContext, _node?: SubscriptionTreeItem): Promise<void> {
    const all = extensions.all;

    const extCommands = all.map((azExt) => (azExt.packageJSON as any)?.contributes?.azExt?.commands as unknown).filter((value) => value !== undefined);
    const createCommands: Command[] = [];

    extCommands.forEach((extCommand: Command[]) => createCommands.push(...extCommand));

    const pick = await _context.ui.showQuickPick(createCommands.map((command: Command): IAzureQuickPickItem<Command> => ({ label: command.title, data: command })), { placeHolder: 'Select a resource to create' });

    if (pick) {
        await commands.executeCommand(pick.data.command);
    }
}
