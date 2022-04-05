/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, parseError } from '@microsoft/vscode-azext-utils';
import { AppResource } from '../api';
import { revealTreeItem } from '../api/revealTreeItem';

export async function revealResource(context: IActionContext, resource: AppResource): Promise<void> {
    context.telemetry.properties.resourceType = resource.type?.replace(/\//g, '|'); // Replace the slashes otherwise this gets redacted because it looks like a user file path
    context.telemetry.properties.resourceKind = resource.kind;
    try {
        await revealTreeItem(resource.id);
    } catch (error) {
        context.telemetry.properties.revealError = parseError(error).message;
    }

}
