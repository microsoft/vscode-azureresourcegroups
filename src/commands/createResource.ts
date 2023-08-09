/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import { Command, Extension, commands, extensions } from 'vscode';
import { AzExtResourceType } from '../../api/src/AzExtResourceType';
import { SubscriptionItem } from '../tree/azure/SubscriptionItem';
import { getIconPath } from '../utils/azureUtils';
import { getResourceContributions } from '../utils/getResourceContributions';

interface ContributedCreateResourceCommand extends Command {
    detail?: string;
    type?: AzExtResourceType;
    extensionId: string;
}

export async function createResource(context: IActionContext, node?: SubscriptionItem): Promise<void> {
    const picks = getPicks(getContributedCreateResourceCommands());
    const pick: IAzureQuickPickItem<ContributedCreateResourceCommand> = await context.ui.showQuickPick(picks, {
        placeHolder: 'Select a resource to create'
    });

    if (pick) {
        // Manually activate extension before executing command to prevent VS Code from serializing arguments.
        // See https://github.com/microsoft/vscode-azureresourcegroups/issues/559 for details.
        await extensions.getExtension(pick.data.extensionId)?.activate();
        await commands.executeCommand(pick.data.command, node);
    }
}

function getPicks(createResourceCommands: ContributedCreateResourceCommand[]): IAzureQuickPickItem<ContributedCreateResourceCommand>[] {
    return createResourceCommands
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(command => ({
            label: command.title,
            data: command,
            detail: command.detail,
            iconPath: command.type && Object.values(AzExtResourceType).includes(command.type) ? getIconPath(command.type) : undefined,
        }));
}

function getContributedCreateResourceCommands(): ContributedCreateResourceCommand[] {
    const getCommandsForExtension = (extension: Extension<unknown>): ContributedCreateResourceCommand[] | undefined =>
        getResourceContributions(extension)?.commands?.map(command => ({ extensionId: extension.id, ...command }));

    const createCommands: ContributedCreateResourceCommand[] = [];
    extensions.all.forEach(extension => createCommands.push(...(getCommandsForExtension(extension) ?? [])));
    return createCommands;
}
