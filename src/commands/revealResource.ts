/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, parseError } from '@microsoft/vscode-azext-utils';
import { AzureExtensionApi, AzureExtensionApiProvider } from '@microsoft/vscode-azext-utils/api';
import { commands, Extension } from 'vscode';
import { AzExtWrapper, getAzureExtensions } from '../AzExtWrapper';
import { ResourceTreeItem } from '../tree/ResourceTreeItem';
import { viewProperties } from './viewProperties';

export async function revealResource(context: IActionContext, node: ResourceTreeItem): Promise<void> {
    context.telemetry.properties.resourceType = node.data.type?.replace(/\//g, '|'); // Replace the slashes otherwise this gets redacted because it looks like a user file path
    context.telemetry.properties.resourceKind = node.data.kind;

    const azExtension: AzExtWrapper | undefined = getAzureExtensions().find(e => e.matchesResourceType(node.data));

    let viewPropertiesInstead: boolean = false;
    if (!azExtension) {
        viewPropertiesInstead = true;
    } else {
        const extension: Extension<AzureExtensionApiProvider> | undefined = azExtension.getCodeExtension();
        if (!extension) {
            await commands.executeCommand('extension.open', azExtension.id);
        } else {
            if (!extension.isActive) {
                await extension.activate();
            }

            try {
                const api: IRevealApi = extension.exports.getApi('*');
                await api.revealTreeItem(node.fullId);
            } catch (error) {
                viewPropertiesInstead = true;
                context.telemetry.properties.revealError = parseError(error).message;
            }
        }
    }

    if (viewPropertiesInstead) {
        await viewProperties(context, node);
    }
}

interface IRevealApi extends AzureExtensionApi {
    revealTreeItem(resourceId: string): Promise<void>;
}
