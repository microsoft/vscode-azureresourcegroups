/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import { Command, commands, extensions } from 'vscode';
import { contributesKey } from '../constants';
import { SubscriptionItem } from '../tree/azure/SubscriptionItem';

interface AzExtCreateResourceCommand extends Command {
    title: string;
    detail?: string;
}

export async function createResource(context: IActionContext, node?: SubscriptionItem): Promise<void> {
    const all = extensions.all;

    const extCommands = all.map((azExt) => azExt.packageJSON?.contributes?.[contributesKey]?.commands as unknown).filter((value) => value !== undefined);
    const createCommands: AzExtCreateResourceCommand[] = [];

    extCommands.forEach((extCommand: AzExtCreateResourceCommand[]) => createCommands.push(...extCommand));

    const pick = await context.ui.showQuickPick(createCommands.sort((a, b) => a.title.localeCompare(b.title)).map((command: AzExtCreateResourceCommand): IAzureQuickPickItem<AzExtCreateResourceCommand> => ({ label: command.title, data: command, detail: command.detail })), { placeHolder: 'Select a resource to create' });

    if (pick) {
        await commands.executeCommand(pick.data.command, node);
    }
}
