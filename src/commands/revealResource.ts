/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParsedAzureResourceId } from '@microsoft/vscode-azext-azureutils';
import { AzExtTreeItem, IActionContext, ResourceGroupsItem, maskUserInfo, parseError } from '@microsoft/vscode-azext-utils';
import { AzureResourceRevealOptions, AzureResourceRevealResult, ResourceModelBase, VSCodeRevealOptions } from '../../api/src/index';
import { ext } from '../extensionVariables';
import { AzureResourceTreeDataProvider } from '../tree/azure/AzureResourceTreeDataProvider';
import { TreeDataItem } from '../tree/ResourceGroupsItem';
import { ResourceTreeDataProviderBase } from '../tree/ResourceTreeDataProviderBase';
import { localize } from '../utils/localize';
import { TreeTraversalContext } from '../utils/treeOperations';
import { BranchDataItemWrapper } from '../tree/BranchDataItemWrapper';

export async function revealResourceWithResult(context: IActionContext, resourceId: string, options?: AzureResourceRevealOptions): Promise<AzureResourceRevealResult> {
    context.valuesToMask.push(resourceId);
    const parsedId = parsePartialAzureResourceId(resourceId);
    if (!parsedId.subscriptionId) {
        throw new Error(localize('invalidRevealResourceId', 'An Azure resource ID beginning with /subscriptions/{subscriptionId} is required.'));
    }
    context.valuesToMask.push(parsedId.subscriptionId);
    for (const value of [parsedId.resourceGroup, parsedId.resourceName, ...parsedId.subResourcePath?.split('/') ?? []]) {
        if (value) {
            context.valuesToMask.push(value);
        }
    }
    const provider = ext.v2.api.resources.azureResourceTreeDataProvider as AzureResourceTreeDataProvider;
    const subscriptionId = await provider.resolveSubscriptionForReveal(
        context, parsedId.subscriptionId, options?.tenantId, options?.includeFilteredSubscription);
    const qualifiedId = subscriptionId + resourceId.replace(/^\/subscriptions\/[^/]+/i, '');
    context.valuesToMask.push(qualifiedId);
    const operation: TreeTraversalContext = { propagateErrors: true, targetId: qualifiedId };
    const item = await provider.findItemById(qualifiedId, operation);
    if (!item?.id) {
        throw new Error(localize('revealResourceNotFound', 'The requested Azure resource could not be found in the resource tree.'));
    }
    const resource = item instanceof BranchDataItemWrapper ? item.unwrap<ResourceModelBase>() : undefined;
    await ext.appResourceTreeView.reveal(item as unknown as AzExtTreeItem, options?.revealOptions ?? { expand: false, focus: true, select: true });
    return { id: item.id, resource };
}

export async function revealResource(context: IActionContext, resourceId: string, options?: VSCodeRevealOptions): Promise<void> {
    setTelemetryPropertiesForId(context, resourceId);

    try {
        const item: TreeDataItem | undefined = await (ext.v2.api.resources.azureResourceTreeDataProvider as ResourceTreeDataProviderBase).findItemById(resourceId);
        if (item) {
            await ext.appResourceTreeView.reveal(item as unknown as AzExtTreeItem, options ?? { expand: false, focus: true, select: true });
        }
    } catch (error) {
        context.telemetry.properties.revealError = maskUserInfo(parseError(error).message, []);
    }
}

export async function revealWorkspaceResource(context: IActionContext, resourceId: string, options?: VSCodeRevealOptions): Promise<void> {
    try {
        const item: ResourceGroupsItem | undefined = await (ext.v2.api.resources.workspaceResourceTreeDataProvider as ResourceTreeDataProviderBase).findItemById(resourceId);
        if (item) {
            await ext.workspaceTreeView.reveal(item as unknown as AzExtTreeItem, options ?? { expand: false, focus: true, select: true });
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

function parsePartialAzureResourceId(id: string): Partial<ParsedAzureResourceId> & Pick<ParsedAzureResourceId, 'rawId'> & { subResourcePath?: string } {
    const matches = id.match(/^\/subscriptions\/([^/]*)(\/resourceGroups\/([^/]*)(\/providers\/([^/]*\/[^/]*)\/([^/]*)(\/(.*))?)?)?$/i);
    return {
        rawId: id,
        subscriptionId: matches?.[1],
        resourceGroup: matches?.[3],
        provider: matches?.[5],
        resourceName: matches?.[6],
        subResourcePath: matches?.[8]
    };
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
