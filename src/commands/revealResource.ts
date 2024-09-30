/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParsedAzureResourceId } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeItem, IActionContext, maskUserInfo, parseError } from '@microsoft/vscode-azext-utils';
import { VSCodeRevealOptions } from '../../api/src/index';
import { ext } from '../extensionVariables';
import { ResourceGroupsItem } from '../tree/ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from '../tree/ResourceTreeDataProviderBase';

export async function revealResource(context: IActionContext, resourceId: string, options?: VSCodeRevealOptions): Promise<void> {
    setTelemetryPropertiesForId(context, resourceId);

    try {
        const item: ResourceGroupsItem | undefined = await (ext.v2.api.resources.azureResourceTreeDataProvider as ResourceTreeDataProviderBase).findItemById(resourceId);
        if (item) {
            await ext.appResourceTreeView.reveal(item as unknown as AzExtTreeItem, options ?? { expand: false, focus: true, select: true });
        }
    } catch (error) {
        context.telemetry.properties.revealError = maskUserInfo(parseError(error).message, []);
    }
}

function setTelemetryPropertiesForId(context: IActionContext, resourceId: string): void {
    const parsedAzureResourceId = parsePartialAzureResourceId(resourceId);
    const resourceKind = getResourceKindFromId(parsedAzureResourceId);
    context.telemetry.properties.resourceKind = resourceKind;

    if (resourceKind === 'resource') {
        context.telemetry.properties.resourceType = parsedAzureResourceId.provider?.replace(/\//g, '|');
    }
}

function parsePartialAzureResourceId(id: string): Partial<ParsedAzureResourceId> & Pick<ParsedAzureResourceId, 'rawId'> {
    const matches = id.match(/^\/subscriptions\/([^\/]*)(\/resourceGroups\/([^\/]*)(\/providers\/([^\/]*\/[^\/]*)\/([^\/]*))?)?$/i);
    return {
        rawId: id,
        subscriptionId: matches?.[1],
        resourceGroup: matches?.[3],
        provider: matches?.[5],
        resourceName: matches?.[6]
    }
}

function getResourceKindFromId(parsedId: Partial<ParsedAzureResourceId>): 'subscription' | 'resourceGroup' | 'resource' {
    if (parsedId.resourceName) {
        return 'resource';
    } else if (parsedId.resourceGroup) {
        return 'resourceGroup';
    } else if (parsedId.subscriptionId) {
        return 'subscription';
    }

    throw new Error('Invalid Azure Resource Id');
}
