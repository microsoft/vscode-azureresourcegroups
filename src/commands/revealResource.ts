/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAzureResourceId } from '@microsoft/vscode-azext-azureutils';
import { IActionContext, parseError } from '@microsoft/vscode-azext-utils';
import { AppResource } from '@microsoft/vscode-azext-utils/hostapi';
import { ext } from '../extensionVariables';
import { AppResourceTreeItem } from '../tree/AppResourceTreeItem';
import { SubscriptionTreeItem } from '../tree/SubscriptionTreeItem';

export async function revealResource(context: IActionContext, resourceId: string): Promise<void>;
export async function revealResource(context: IActionContext, resource: AppResource): Promise<void>;
export async function revealResource(context: IActionContext, arg: AppResource | string): Promise<void> {
    const resourceId = typeof arg === 'string' ? arg : arg.id;

    context.telemetry.properties.resourceType = parseAzureResourceId(resourceId).provider.replace(/\//g, '|');

    try {
        const subscriptionNode: SubscriptionTreeItem | undefined = await ext.appResourceTree.findTreeItem(`/subscriptions/${parseAzureResourceId(resourceId).subscriptionId}`, { ...context, loadAll: true });
        const appResourceNode: AppResourceTreeItem | undefined = await subscriptionNode?.findAppResourceByResourceId(context, resourceId);
        if (appResourceNode) {
            // ensure the parent node loaded this AppResourceTreeItem
            await appResourceNode.parent?.getCachedChildren(context);
            await ext.appResourceTreeView.reveal(appResourceNode, { select: true, focus: true, expand: false });
        }
    } catch (error) {
        context.telemetry.properties.revealError = parseError(error).message;
    }
}
