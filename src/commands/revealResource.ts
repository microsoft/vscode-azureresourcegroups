/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAzureResourceId } from '@microsoft/vscode-azext-azureutils';
import { IActionContext, parseError } from '@microsoft/vscode-azext-utils';
import { AppResource } from '@microsoft/vscode-azext-utils/hostapi';
import { revealTreeItem } from '../api/revealTreeItem';
import { ext } from '../extensionVariables';
import { AppResourceTreeItem } from '../tree/AppResourceTreeItem';
import { SubscriptionTreeItem } from '../tree/SubscriptionTreeItem';

export async function revealResource(context: IActionContext, resource: AppResource): Promise<void> {
    context.telemetry.properties.resourceType = resource.type?.replace(/\//g, '|'); // Replace the slashes otherwise this gets redacted because it looks like a user file path
    context.telemetry.properties.resourceKind = resource.kind;
    try {
        const subscriptionNode: SubscriptionTreeItem | undefined = await ext.appResourceTree.findTreeItem(`/subscriptions/${parseAzureResourceId(resource.id).subscriptionId}`, { ...context, loadAll: true });
        const appResourceNode: AppResourceTreeItem | undefined = await subscriptionNode?.findAppResourceByResourceId(context, resource.id);
        if (appResourceNode) {
            // ensure the parent node loaded this AppResourceTreeItem
            await appResourceNode.parent?.getCachedChildren(context);
            await revealTreeItem(appResourceNode);
        }
    } catch (error) {
        context.telemetry.properties.revealError = parseError(error).message;
    }

}
