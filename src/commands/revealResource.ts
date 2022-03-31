/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, parseError } from '@microsoft/vscode-azext-utils';
import { revealTreeItem } from '../api/revealTreeItem';
import { AppResourceTreeItem } from '../tree/AppResourceTreeItem';

export async function revealResource(context: IActionContext, node: AppResourceTreeItem): Promise<void> {
    context.telemetry.properties.resourceType = node.data.type?.replace(/\//g, '|'); // Replace the slashes otherwise this gets redacted because it looks like a user file path
    context.telemetry.properties.resourceKind = node.data.kind;
    try {
        await revealTreeItem(node.fullId);
    } catch (error) {
        context.telemetry.properties.revealError = parseError(error).message;
    }

}
