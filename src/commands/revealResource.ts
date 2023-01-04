/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAzureResourceId } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeItem, IActionContext, parseError } from '@microsoft/vscode-azext-utils';
import { AppResource } from '@microsoft/vscode-azext-utils/hostapi';
import { ext } from '../extensionVariables';
import { ResourceGroupsItem } from '../tree/v2/ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from '../tree/v2/ResourceTreeDataProviderBase';

export async function revealResource(context: IActionContext, resourceId: string): Promise<void>;
export async function revealResource(context: IActionContext, resource: AppResource): Promise<void>;
export async function revealResource(context: IActionContext, arg: AppResource | string): Promise<void> {
    const resourceId = typeof arg === 'string' ? arg : arg.id;

    context.telemetry.properties.resourceType = parseAzureResourceId(resourceId).provider.replace(/\//g, '|');

    try {
        const item: ResourceGroupsItem | undefined = await (ext.v2.api.resources.azureResourceTreeDataProvider as ResourceTreeDataProviderBase).findItemById(resourceId);
        if (item) {
            await ext.appResourceTreeView.reveal(item as unknown as AzExtTreeItem, { expand: false, focus: true, select: true });
        }
    } catch (error) {
        context.telemetry.properties.revealError = parseError(error).message;
    }
}
